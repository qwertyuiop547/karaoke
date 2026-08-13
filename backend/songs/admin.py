from django.contrib import admin, messages
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import path, reverse
from django.utils.html import format_html
from .csv_import import import_songs_csv
from .catalog_refresh import log_catalog_refresh
from .models import CatalogSeedLog, Song, SongReport, SubscriberProfile
from .report_resolve import ResolveError, resolve_report


@admin.register(SubscriberProfile)
class SubscriberProfileAdmin(admin.ModelAdmin):
    list_display = (
        'user',
        'status',
        'email_verified',
        'trial_used',
        'is_banned',
        'current_period_end',
        'manual_override_until',
        'stripe_customer_id',
        'updated_at',
    )
    list_filter = ('status', 'trial_used', 'email_verified', 'is_banned')
    search_fields = ('user__username', 'user__email', 'stripe_customer_id', 'stripe_subscription_id')
    raw_id_fields = ('user',)

@admin.register(Song)
class SongAdmin(admin.ModelAdmin):
    list_display = ('platinum_number', 'title', 'artist', 'language', 'genre', 'updated_at')
    list_filter = ('language', 'genre')
    search_fields = ('title', 'artist', 'platinum_number')
    ordering = ('title',)
    change_list_template = 'admin/songs/song/change_list.html'

    def get_urls(self):
        urls = super().get_urls()
        custom = [
            path(
                'upload-csv/',
                self.admin_site.admin_view(self.upload_csv),
                name='songs_song_upload_csv',
            ),
        ]
        return custom + urls

    def upload_csv(self, request):
        context = {
            **self.admin_site.each_context(request),
            'title': 'Upload Songs CSV',
            'opts': self.model._meta,
        }

        if request.method == 'POST':
            upload = request.FILES.get('csv_file')
            if not upload:
                messages.error(request, 'Pumili muna ng CSV file.')
                return render(request, 'admin/songs/song/upload_csv.html', context)

            try:
                result = import_songs_csv(upload)
            except ValueError as exc:
                messages.error(request, str(exc))
                return render(request, 'admin/songs/song/upload_csv.html', context)

            log_catalog_refresh(
                source=CatalogSeedLog.Source.CSV_UPLOAD,
                created=result['created'],
                updated=result['updated'],
                skipped=result['skipped'],
                note=upload.name or 'django-admin upload',
            )

            messages.success(
                request,
                f"Upload complete. Created {result['created']}, "
                f"updated {result['updated']}, skipped {result['skipped']}.",
            )
            return redirect('admin:songs_song_changelist')

        return render(request, 'admin/songs/song/upload_csv.html', context)


@admin.register(SongReport)
class SongReportAdmin(admin.ModelAdmin):
    list_display = (
        'status_badge',
        'platinum_number',
        'title',
        'artist',
        'suggested_number',
        'created_at',
        'resolve_link',
    )
    list_filter = ('status',)
    search_fields = ('platinum_number', 'title', 'artist', 'note', 'suggested_number')
    fields = (
        'status',
        'song',
        'platinum_number',
        'title',
        'artist',
        'suggested_number',
        'note',
        'admin_notes',
        'resolve_link',
        'created_at',
        'updated_at',
    )
    ordering = ('-created_at',)
    actions = ['mark_reviewed', 'mark_rejected', 'mark_fixed']
    change_list_template = 'admin/songs/songreport/change_list.html'

    def get_readonly_fields(self, request, obj=None):
        # On add, allow filling report fields; Resolve link only after save.
        if obj is None:
            return ('created_at', 'updated_at', 'resolve_link')
        return (
            'song',
            'platinum_number',
            'title',
            'artist',
            'suggested_number',
            'note',
            'created_at',
            'updated_at',
            'resolve_link',
        )

    def status_badge(self, obj):
        colors = {
            'open': '#c0392b',
            'reviewed': '#d68910',
            'fixed': '#1e8449',
            'rejected': '#7f8c8d',
        }
        color = colors.get(obj.status, '#333')
        return format_html(
            '<span style="background:{};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;">{}</span>',
            color,
            obj.get_status_display(),
        )

    status_badge.short_description = 'Status'
    status_badge.admin_order_field = 'status'

    def resolve_link(self, obj):
        if not obj or not obj.pk:
            return '—'
        url = reverse('admin:songs_songreport_resolve', args=[obj.pk])
        return format_html('<a class="button" href="{}">Resolve / Fix</a>', url)

    resolve_link.short_description = 'Action'

    def get_urls(self):
        urls = super().get_urls()
        custom = [
            path(
                '<int:report_id>/resolve/',
                self.admin_site.admin_view(self.resolve_report),
                name='songs_songreport_resolve',
            ),
        ]
        return custom + urls

    @admin.action(description='Mark selected as Reviewed')
    def mark_reviewed(self, request, queryset):
        updated = queryset.update(status=SongReport.Status.REVIEWED)
        self.message_user(request, f'{updated} report(s) marked as Reviewed.')

    @admin.action(description='Mark selected as Rejected')
    def mark_rejected(self, request, queryset):
        updated = queryset.update(status=SongReport.Status.REJECTED)
        self.message_user(request, f'{updated} report(s) marked as Rejected.')

    @admin.action(description='Mark selected as Fixed')
    def mark_fixed(self, request, queryset):
        updated = queryset.update(status=SongReport.Status.FIXED)
        self.message_user(request, f'{updated} report(s) marked as Fixed.')

    def resolve_report(self, request, report_id):
        report = get_object_or_404(SongReport, pk=report_id)
        song = report.song or Song.objects.filter(platinum_number=report.platinum_number).first()

        context = {
            **self.admin_site.each_context(request),
            'title': f'Resolve report #{report.id}',
            'opts': self.model._meta,
            'report': report,
            'song': song,
            'default_title': (song.title if song else report.title) or '',
            'default_artist': (song.artist if song else report.artist) or '',
            'default_language': (song.language if song else '') or '',
            'default_genre': (song.genre if song else '') or '',
            'default_number': report.suggested_number or report.platinum_number,
        }

        if request.method != 'POST':
            return render(request, 'admin/songs/songreport/resolve.html', context)

        try:
            message, level = resolve_report(
                report,
                action=request.POST.get('action'),
                admin_notes=(request.POST.get('admin_notes') or '').strip(),
                correct_number=(request.POST.get('correct_number') or '').strip(),
                title=(request.POST.get('title') or '').strip(),
                artist=(request.POST.get('artist') or '').strip(),
                language=(request.POST.get('language') or '').strip(),
                genre=(request.POST.get('genre') or '').strip(),
            )
        except ResolveError as exc:
            messages.error(request, exc.message)
            return redirect('admin:songs_songreport_resolve', report_id)
        except Exception as exc:
            messages.error(request, f'Error: {exc}')
            return redirect('admin:songs_songreport_resolve', report_id)

        if level == 'warning':
            messages.warning(request, message)
        elif level == 'info':
            messages.info(request, message)
        else:
            messages.success(request, message)
        return redirect('admin:songs_songreport_changelist')


@admin.register(CatalogSeedLog)
class CatalogSeedLogAdmin(admin.ModelAdmin):
    list_display = (
        'created_at',
        'source',
        'songs_created',
        'songs_updated',
        'songs_skipped',
        'songs_deleted',
        'songs_total',
        'note',
    )
    list_filter = ('source',)
    readonly_fields = (
        'source',
        'songs_created',
        'songs_updated',
        'songs_skipped',
        'songs_deleted',
        'songs_total',
        'note',
        'created_at',
    )
    ordering = ('-created_at',)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
