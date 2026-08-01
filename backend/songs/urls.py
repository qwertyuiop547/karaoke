from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import SongViewSet, SongReportView, SongReportResolveView, AnalyticsSummaryView
from .auth_views import (
    AdminChangePasswordView,
    AdminLoginView,
    AdminLogoutView,
    AdminMeView,
    CsrfView,
    SubscriberLoginView,
    SubscriberRegisterView,
)
from .billing_views import (
    BillingAdminActivateView,
    BillingCheckoutView,
    BillingPortalView,
    BillingStartTrialView,
    BillingSubscribersListView,
    BillingWebhookView,
)
from .presence_views import PresenceOnlineView, PresencePingView

router = DefaultRouter()
router.register(r'songs', SongViewSet, basename='song')

urlpatterns = [
    path('auth/csrf/', CsrfView.as_view(), name='auth-csrf'),
    path('auth/login/', AdminLoginView.as_view(), name='auth-login'),
    path('auth/logout/', AdminLogoutView.as_view(), name='auth-logout'),
    path('auth/me/', AdminMeView.as_view(), name='auth-me'),
    path(
        'auth/change-password/',
        AdminChangePasswordView.as_view(),
        name='auth-change-password',
    ),
    path('auth/register/', SubscriberRegisterView.as_view(), name='auth-register'),
    path(
        'auth/subscriber-login/',
        SubscriberLoginView.as_view(),
        name='auth-subscriber-login',
    ),
    path('billing/checkout/', BillingCheckoutView.as_view(), name='billing-checkout'),
    path('billing/start-trial/', BillingStartTrialView.as_view(), name='billing-start-trial'),
    path('billing/portal/', BillingPortalView.as_view(), name='billing-portal'),
    path('billing/webhook/', BillingWebhookView.as_view(), name='billing-webhook'),
    path(
        'billing/admin-activate/',
        BillingAdminActivateView.as_view(),
        name='billing-admin-activate',
    ),
    path(
        'billing/subscribers/',
        BillingSubscribersListView.as_view(),
        name='billing-subscribers',
    ),
    path('presence/ping/', PresencePingView.as_view(), name='presence-ping'),
    path('presence/online/', PresenceOnlineView.as_view(), name='presence-online'),
    path('analytics/summary/', AnalyticsSummaryView.as_view(), name='analytics-summary'),
    path(
        'reports/<int:report_id>/resolve/',
        SongReportResolveView.as_view(),
        name='song-report-resolve',
    ),
    path('reports/', SongReportView.as_view(), name='song-reports'),
    path('', include(router.urls)),
]
