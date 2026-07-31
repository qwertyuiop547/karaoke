from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .permissions import IsStaffUser
from .presence_store import list_online, set_presence
from .ratelimit import client_ip, is_rate_limited


def _short_guest_name(visitor_key: str) -> str:
    suffix = (visitor_key or 'guest')[-4:].upper()
    return f'Guest-{suffix}'


def _device_label(user_agent: str) -> str:
    ua = (user_agent or '').lower()
    if 'iphone' in ua or 'ipad' in ua:
        return 'iOS'
    if 'android' in ua:
        return 'Android'
    if 'windows' in ua:
        return 'Windows'
    if 'mac os' in ua or 'macintosh' in ua:
        return 'Mac'
    if 'linux' in ua:
        return 'Linux'
    return 'Web'


def _django_user(request):
    """Session user without SessionAuthentication (avoids CSRF on public ping)."""
    django_request = getattr(request, '_request', None)
    if django_request is not None:
        return getattr(django_request, 'user', None)
    return getattr(request, 'user', None)


def _is_staff_user(user) -> bool:
    if not user:
        return False
    try:
        return bool(
            user.is_authenticated
            and user.is_active
            and (user.is_staff or user.is_superuser)
        )
    except Exception:
        return False


class PresencePingView(APIView):
    """Public heartbeat — cache only; never fail the songbook UI."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        try:
            visitor_key = (request.data.get('visitor_key') or '').strip()[:64]
            if len(visitor_key) < 8:
                return Response(
                    {'detail': 'visitor_key is required.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            ip = client_ip(request)
            # Soft-limit: never 429 the UI; excess pings are ignored quietly.
            if is_rate_limited(f'presence:ip:{ip}', limit=1200, window_seconds=600):
                return Response({'ok': True, 'skipped': True})
            if is_rate_limited(f'presence:vk:{visitor_key}', limit=120, window_seconds=600):
                return Response({'ok': True, 'skipped': True})

            path = (request.data.get('path') or '').strip()[:120] or 'songbook'
            user_agent = (request.META.get('HTTP_USER_AGENT') or '')[:255]

            user = _django_user(request)
            if _is_staff_user(user):
                role = 'admin'
                display_name = user.username
            else:
                role = 'guest'
                display_name = _short_guest_name(visitor_key)

            payload = set_presence(
                visitor_key,
                display_name=display_name,
                role=role,
                path=path,
                user_agent=user_agent,
            )

            return Response(
                {
                    'ok': True,
                    'display_name': payload['display_name'],
                    'role': payload['role'],
                }
            )
        except Exception:
            # Presence must not break the songbook (e.g. transient cache/DB issues).
            return Response({'ok': False}, status=status.HTTP_200_OK)


class PresenceOnlineView(APIView):
    """Staff-only list of recently active visitors (from cache/Redis)."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsStaffUser]

    def get(self, request):
        try:
            online = list_online()
        except Exception:
            online = []

        results = []
        for row in online:
            results.append(
                {
                    'id': row.get('visitor_key'),
                    'display_name': row.get('display_name')
                    or _short_guest_name(row.get('visitor_key') or ''),
                    'role': row.get('role') or 'guest',
                    'path': row.get('path') or 'songbook',
                    'device': _device_label(row.get('user_agent') or ''),
                    'seconds_ago': row.get('seconds_ago', 0),
                    'last_seen': row.get('last_seen'),
                }
            )

        admins = [r for r in results if r['role'] == 'admin']
        guests = [r for r in results if r['role'] != 'admin']

        return Response(
            {
                'count': len(results),
                'admin_count': len(admins),
                'guest_count': len(guests),
                'results': results,
            }
        )
