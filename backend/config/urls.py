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


@csrf_exempt
@never_cache
def health(_request):
    """Platform healthchecks (Railway/Render) — plain 200, no redirects."""
    return JsonResponse({'ok': True})


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/health/', health),
    path('api/', include('songs.urls')),
    re_path(r'^(?!api/|admin/|static/).*$', spa_index),
]
