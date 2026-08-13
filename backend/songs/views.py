import hashlib
import random

from rest_framework import viewsets, filters, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from django_filters.rest_framework import DjangoFilterBackend
from django.core.cache import cache
from django.db.models import Count, Max, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from datetime import timedelta

from .cache_utils import (
    bust_song_list_cache,
    song_list_cache_key,
    song_list_cache_ttl,
)
from .catalog_refresh import log_catalog_refresh
from .csv_import import import_songs_csv
from .entitlements import user_has_offline_access
from .models import CatalogSeedLog, SearchEvent, Song, SongReport
from .permissions import IsStaffUser, ReadOnlyOrStaff
from .ratelimit import client_ip, is_rate_limited
from .report_resolve import ResolveError, resolve_report
from .safe_input import clean_letter, clean_report_status, clean_search, clean_song_category
from .serializers import (
    ResolveReportSerializer,
    SongReportAdminSerializer,
    SongReportSerializer,
    SongSerializer,
)


class SongPagination(PageNumberPagination):
    page_size = 10
    page_size_query_param = 'page_size'
    max_page_size = 200


class ReportPagination(PageNumberPagination):
    page_size = 30
    page_size_query_param = 'page_size'
    max_page_size = 100


class SongViewSet(viewsets.ModelViewSet):
    """Official Platinum Karaoke song directory — public read, staff write."""

    serializer_class = SongSerializer
    pagination_class = SongPagination
    permission_classes = [ReadOnlyOrStaff]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['title', 'artist', 'platinum_number']
    filterset_fields = ['language', 'genre']
    ordering_fields = ['title', 'artist', 'platinum_number']
    ordering = ['title']

    def get_authenticators(self):
        # Offline pack needs the session cookie to check subscription.
        path = getattr(getattr(self, 'request', None), 'path', '') or ''
        if 'offline-pack' in path:
            return [SessionAuthentication()]
        # Skip SessionAuthentication on public GETs to avoid CSRF/session cost.
        if self.request.method in ('GET', 'HEAD', 'OPTIONS'):
            return []
        return [SessionAuthentication()]

    def get_queryset(self):
        qs = Song.objects.all()
        letter = clean_letter(self.request.query_params.get('letter'))
        if letter != 'ALL':
            qs = qs.filter(title__istartswith=letter)

        category = clean_song_category(self.request.query_params.get('category'))
        if category == 'opm':
            qs = qs.filter(Q(language__iexact='Filipino') | Q(genre__iexact='OPM'))
        elif category == 'english':
            qs = qs.filter(language__iexact='English')

        return qs

    def list(self, request, *args, **kwargs):
        if is_rate_limited(
            f'songs:get:{client_ip(request)}',
            limit=120,
            window_seconds=60,
        ):
            return Response(
                {'detail': 'Too many song requests. Slow down a bit.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        # Normalize search length before DRF SearchFilter runs via query_params copy.
        search = clean_search(request.query_params.get('search'))
        if 'search' in request.query_params:
            mutable = request.query_params.copy()
            mutable['search'] = search
            request._request.GET = mutable

        query_string = request.META.get('QUERY_STRING', '')
        cache_key = song_list_cache_key(query_string)
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        response = super().list(request, *args, **kwargs)
        cache.set(cache_key, response.data, song_list_cache_ttl())

        # Analytics: always log typed searches; sample letter/category browses.
        page = (request.query_params.get('page') or '1').strip()
        if page in ('', '1'):
            query = search
            letter = clean_letter(request.query_params.get('letter'))
            category = (clean_song_category(request.query_params.get('category')) or 'ALL').upper()
            filtered = bool(query or letter != 'ALL' or category not in ('ALL', ''))
            should_log = bool(query) or (filtered and random.random() < 0.1)
            if should_log:
                count = response.data.get('count')
                if count is None and isinstance(response.data, list):
                    count = len(response.data)
                try:
                    SearchEvent.objects.create(
                        query=query,
                        letter=letter or 'ALL',
                        category=category or 'ALL',
                        result_count=int(count or 0),
                    )
                except Exception:
                    pass
        return response

    def perform_create(self, serializer):
        serializer.save()
        bust_song_list_cache()

    def perform_update(self, serializer):
        serializer.save()
        bust_song_list_cache()

    def perform_destroy(self, instance):
        instance.delete()
        bust_song_list_cache()

    @action(detail=False, methods=['get'], url_path='offline-pack')
    def offline_pack(self, request):
        """Compact catalog payload for offline/PWA caching (subscribers only)."""
        user = request.user
        if not user.is_authenticated:
            return Response(
                {
                    'detail': 'Sign in to download the offline catalog.',
                    'code': 'login_required',
                },
                status=status.HTTP_401_UNAUTHORIZED,
            )
        if not user_has_offline_access(user):
            return Response(
                {
                    'detail': 'Offline Pass subscription required.',
                    'code': 'subscription_required',
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        stats = Song.objects.aggregate(count=Count('id'), latest=Max('updated_at'))
        count = stats['count'] or 0
        latest = stats['latest']
        latest_token = latest.isoformat() if latest else '0'
        etag_src = f'{count}:{latest_token}'
        etag = hashlib.md5(etag_src.encode('utf-8')).hexdigest()
        inm = (request.META.get('HTTP_IF_NONE_MATCH') or '').strip().strip('"')
        if inm == etag:
            return Response(status=status.HTTP_304_NOT_MODIFIED)

        songs = Song.objects.order_by('title').values(
            'id',
            'title',
            'artist',
            'platinum_number',
            'language',
            'genre',
        )
        response = Response({'count': count, 'results': list(songs)})
        response['ETag'] = f'"{etag}"'
        response['Cache-Control'] = 'private, max-age=300'
        return response

    @action(
        detail=False,
        methods=['post'],
        url_path='upload-csv',
        parser_classes=[MultiPartParser, FormParser],
        permission_classes=[IsStaffUser],
        authentication_classes=[SessionAuthentication],
    )
    def upload_csv(self, request):
        upload = request.FILES.get('csv_file') or request.FILES.get('file')
        if not upload:
            return Response(
                {'detail': 'Choose a CSV file first.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            result = import_songs_csv(upload)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        bust_song_list_cache()
        log_catalog_refresh(
            source=CatalogSeedLog.Source.CSV_UPLOAD,
            created=result['created'],
            updated=result['updated'],
            skipped=result['skipped'],
            note=(getattr(upload, 'name', '') or 'control-room upload')[:255],
        )
        return Response(
            {
                'ok': True,
                'message': (
                    f"Upload complete. Created {result['created']}, "
                    f"updated {result['updated']}, skipped {result['skipped']}."
                ),
                **result,
            }
        )


class SongReportView(APIView):
    """POST: public report create. GET: staff-only report list."""

    def get_authenticators(self):
        if self.request.method == 'GET':
            return [SessionAuthentication()]
        return []

    def get_permissions(self):
        if self.request.method == 'GET':
            return [IsStaffUser()]
        return []

    def get(self, request):
        qs = SongReport.objects.select_related('song').all()
        status_filter = clean_report_status(request.query_params.get('status'))
        if status_filter != 'all':
            qs = qs.filter(status=status_filter)

        search = clean_search(request.query_params.get('search'))
        if search:
            qs = qs.filter(
                Q(platinum_number__icontains=search)
                | Q(title__icontains=search)
                | Q(artist__icontains=search)
                | Q(note__icontains=search)
                | Q(suggested_number__icontains=search)
            )

        paginator = ReportPagination()
        page = paginator.paginate_queryset(qs, request)
        serializer = SongReportAdminSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)

    def post(self, request):
        if is_rate_limited(
            f'report:{client_ip(request)}',
            limit=20,
            window_seconds=3600,
        ):
            return Response(
                {'detail': 'Too many reports from this device. Please try again later.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        serializer = SongReportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        report = serializer.save()
        return Response(
            {
                'ok': True,
                'id': report.id,
                'message': 'Thanks! Your report was received and will be reviewed by an admin.',
            },
            status=status.HTTP_201_CREATED,
        )


class AnalyticsSummaryView(APIView):
    """Staff dashboard metrics: searches + reports."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsStaffUser]

    def get(self, request):
        since = timezone.now() - timedelta(days=30)
        searches = SearchEvent.objects.filter(created_at__gte=since)
        top_searches = list(
            searches.exclude(query='')
            .values('query')
            .annotate(hits=Count('id'))
            .order_by('-hits')[:15]
        )
        top_reported = list(
            SongReport.objects.values('platinum_number', 'title', 'artist')
            .annotate(hits=Count('id'))
            .order_by('-hits')[:15]
        )
        open_reports = SongReport.objects.filter(status=SongReport.Status.OPEN).count()
        latest_refresh = CatalogSeedLog.objects.order_by('-created_at').first()
        recent_refreshes = list(
            CatalogSeedLog.objects.order_by('-created_at')[:5].values(
                'id',
                'source',
                'songs_created',
                'songs_updated',
                'songs_skipped',
                'songs_deleted',
                'songs_total',
                'note',
                'created_at',
            )
        )
        return Response(
            {
                'window_days': 30,
                'search_count': searches.count(),
                'song_count': Song.objects.count(),
                'open_reports': open_reports,
                'report_count': SongReport.objects.count(),
                'top_searches': top_searches,
                'top_reported': top_reported,
                'catalog_refresh': {
                    'latest': recent_refreshes[0] if recent_refreshes else None,
                    'recent': recent_refreshes,
                },
            }
        )


class SongReportResolveView(APIView):
    """Staff-only resolve actions for a report."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsStaffUser]

    def post(self, request, report_id):
        report = get_object_or_404(SongReport.objects.select_related('song'), pk=report_id)
        serializer = ResolveReportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            message, level = resolve_report(
                report,
                action=data['action'],
                admin_notes=(data.get('admin_notes') or '').strip(),
                correct_number=(data.get('correct_number') or '').strip(),
                title=(data.get('title') or '').strip(),
                artist=(data.get('artist') or '').strip(),
                language=(data.get('language') or '').strip(),
                genre=(data.get('genre') or '').strip(),
            )
        except ResolveError as exc:
            return Response(
                {'detail': exc.message},
                status=exc.status_code,
            )

        bust_song_list_cache()
        report.refresh_from_db()
        return Response(
            {
                'ok': True,
                'level': level,
                'message': message,
                'report': SongReportAdminSerializer(report).data,
            }
        )
