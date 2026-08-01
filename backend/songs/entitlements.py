from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from .models import SubscriberProfile


ACTIVE_STATUSES = {
    SubscriberProfile.Status.ACTIVE,
    SubscriberProfile.Status.TRIALING,
}


def trial_days() -> int:
    try:
        days = int(getattr(settings, 'OFFLINE_TRIAL_DAYS', 2) or 2)
    except (TypeError, ValueError):
        days = 2
    return max(1, days)


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


def _expire_stale_trial(profile) -> None:
    """Flip expired trialing profiles to inactive so UI stays accurate."""
    if profile.status != SubscriberProfile.Status.TRIALING:
        return
    now = timezone.now()
    if profile.current_period_end and profile.current_period_end <= now:
        profile.status = SubscriberProfile.Status.INACTIVE
        profile.save(update_fields=['status', 'updated_at'])


def user_has_offline_access(user) -> bool:
    """Staff always allowed; subscribers need active Stripe period, trial, or manual override."""
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    if user.is_staff or user.is_superuser:
        return True

    profile = get_subscriber_profile(user)
    if profile is None:
        return False

    _expire_stale_trial(profile)

    now = timezone.now()
    if profile.manual_override_until and profile.manual_override_until > now:
        return True

    if profile.status in ACTIVE_STATUSES:
        if profile.current_period_end is None or profile.current_period_end > now:
            return True

    return False


def trial_available(profile) -> bool:
    if profile is None:
        return False
    if profile.trial_used:
        return False
    if profile.status == SubscriberProfile.Status.ACTIVE:
        return False
    if profile.stripe_subscription_id:
        return False
    now = timezone.now()
    if profile.manual_override_until and profile.manual_override_until > now:
        return False
    if (
        profile.status == SubscriberProfile.Status.TRIALING
        and profile.current_period_end
        and profile.current_period_end > now
    ):
        return False
    return True


def start_free_trial(user):
    """
    Start the one-time Offline Pass free trial.
    Returns (ok: bool, profile|None, error_code|None).
    """
    profile = ensure_subscriber_profile(user)
    _expire_stale_trial(profile)

    if user_has_offline_access(user) and profile.status == SubscriberProfile.Status.ACTIVE:
        return False, profile, 'already_active'
    if (
        profile.status == SubscriberProfile.Status.TRIALING
        and profile.current_period_end
        and profile.current_period_end > timezone.now()
    ):
        return False, profile, 'trial_active'
    if profile.trial_used:
        return False, profile, 'trial_used'

    now = timezone.now()
    profile.status = SubscriberProfile.Status.TRIALING
    profile.current_period_end = now + timedelta(days=trial_days())
    profile.trial_used = True
    profile.save(
        update_fields=['status', 'current_period_end', 'trial_used', 'updated_at']
    )
    return True, profile, None


def subscription_payload(user) -> dict:
    profile = get_subscriber_profile(user)
    days = trial_days()
    if profile is None:
        return {
            'status': SubscriberProfile.Status.INACTIVE,
            'current_period_end': None,
            'manual_override_until': None,
            'trial_used': False,
            'trial_available': True,
            'trial_days': days,
            'is_trialing': False,
        }

    _expire_stale_trial(profile)
    now = timezone.now()
    is_trialing = (
        profile.status == SubscriberProfile.Status.TRIALING
        and bool(profile.current_period_end)
        and profile.current_period_end > now
    )
    return {
        'status': profile.status,
        'current_period_end': (
            profile.current_period_end.isoformat() if profile.current_period_end else None
        ),
        'manual_override_until': (
            profile.manual_override_until.isoformat() if profile.manual_override_until else None
        ),
        'trial_used': bool(profile.trial_used),
        'trial_available': trial_available(profile),
        'trial_days': days,
        'is_trialing': is_trialing,
    }
