from pathlib import Path

from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, Http404, JsonResponse
from django.urls import include, path, re_path
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_exempt


@never_cache
def spa_index(_request):
    """Serve the Vite SPA shell for non-API routes (PWA / client routing)."""
    dist = Path(getattr(settings, 'FRONTEND_DIST', settings.BASE_DIR / 'frontend_dist'))
    index = dist / 'index.html'
    if not index.is_file():
        raise Http404('Frontend build missing. Run the production Docker build.')
    return FileResponse(index.open('rb'), content_type='text/html; charset=utf-8')


def _frontend_file(name: str, content_type: str):
    dist = Path(getattr(settings, 'FRONTEND_DIST', settings.BASE_DIR / 'frontend_dist'))
    path = dist / name
    if not path.is_file():
        raise Http404(name)
    return FileResponse(path.open('rb'), content_type=content_type)


@never_cache
def web_manifest(_request):
    """PWA manifest with correct MIME (Chrome installability)."""
    return _frontend_file('manifest.webmanifest', 'application/manifest+json')


@never_cache
def service_worker(_request):
    """Service worker — must not be cached aggressively for updates."""
    response = _frontend_file('sw.js', 'application/javascript; charset=utf-8')
    response['Service-Worker-Allowed'] = '/'
    response['Cache-Control'] = 'no-cache'
    return response


@csrf_exempt
@never_cache
def health(_request):
    """Platform healthchecks (Railway/Render) — plain 200, no redirects."""
    return JsonResponse({'ok': True})


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/health/', health),
    path('api/', include('songs.urls')),
    path('manifest.webmanifest', web_manifest),
    path('sw.js', service_worker),
    re_path(r'^(?!api/|admin/|static/).*$', spa_index),
]
