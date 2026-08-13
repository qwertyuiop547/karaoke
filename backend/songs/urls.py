from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import SongViewSet, SongReportView, SongReportResolveView, AnalyticsSummaryView
from .auth_views import (
    AdminChangePasswordView,
    AdminLoginView,
    AdminLogoutView,
    AdminMeView,
    ApplyReferralView,
    CsrfView,
    ResendVerificationEmailView,
    SubscriberLoginView,
    SubscriberRegisterView,
    VerifyEmailView,
)
from .billing_views import (
    BillingAdminActivateView,
    BillingAdminModerateView,
    BillingCheckoutView,
    BillingPortalView,
    BillingStartTrialView,
    BillingSubscribersListView,
    BillingWebhookView,
    ReferralCampaignAdminView,
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
    path('auth/verify-email/', VerifyEmailView.as_view(), name='auth-verify-email'),
    path(
        'auth/resend-verification/',
        ResendVerificationEmailView.as_view(),
        name='auth-resend-verification',
    ),
    path(
        'subscribers/apply-referral/',
        ApplyReferralView.as_view(),
        name='subscribers-apply-referral',
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
        'billing/admin-moderate/',
        BillingAdminModerateView.as_view(),
        name='billing-admin-moderate',
    ),
    path(
        'billing/subscribers/',
        BillingSubscribersListView.as_view(),
        name='billing-subscribers',
    ),
    path(
        'billing/admin-referral-campaigns/',
        ReferralCampaignAdminView.as_view(),
        name='billing-admin-referral-campaigns',
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
