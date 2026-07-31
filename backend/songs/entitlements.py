from django.utils import timezone

from .models import SubscriberProfile


ACTIVE_STATUSES = {
    SubscriberProfile.Status.ACTIVE,
    SubscriberProfile.Status.TRIALING,
}


def get_subscriber_profile(user):
    if not user or not getattr(user, 'is_authenticated', False):
        return None
    try:
        return user.subscriber_profile
    except SubscriberProfile.DoesNotExist:
        return None


def ensure_subscriber_profile(user):
    profile, _ = SubscriberProfile.objects.get_or_create(user=user)
    return profile


def user_has_offline_access(user) -> bool:
    """Staff always allowed; subscribers need active Stripe period or manual override."""
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    if user.is_staff or user.is_superuser:
        return True

    profile = get_subscriber_profile(user)
    if profile is None:
        return False

    now = timezone.now()
    if profile.manual_override_until and profile.manual_override_until > now:
        return True

    if profile.status in ACTIVE_STATUSES:
        if profile.current_period_end is None or profile.current_period_end > now:
            return True

    return False


def subscription_payload(user) -> dict:
    profile = get_subscriber_profile(user)
    if profile is None:
        return {
            'status': SubscriberProfile.Status.INACTIVE,
            'current_period_end': None,
            'manual_override_until': None,
        }
    return {
        'status': profile.status,
        'current_period_end': (
            profile.current_period_end.isoformat() if profile.current_period_end else None
        ),
        'manual_override_until': (
            profile.manual_override_until.isoformat() if profile.manual_override_until else None
        ),
    }
