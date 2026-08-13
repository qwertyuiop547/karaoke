from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from .email_verify import (
    check_and_send_expiring_emails,
    hash_device_id,
    normalize_device_id,
    send_pass_activated_email,
)
from .models import SubscriberProfile, TrialDevice


ACTIVE_STATUSES = {
    SubscriberProfile.Status.ACTIVE,
    SubscriberProfile.Status.TRIALING,
}


def trial_days() -> int:
    try:
        days = int(getattr(settings, 'OFFLINE_TRIAL_DAYS', 3) or 3)
    except (TypeError, ValueError):
        days = 3
    return max(1, days)


def stripe_configured() -> bool:
    return bool(
        (getattr(settings, 'STRIPE_SECRET_KEY', '') or '').strip()
        and (getattr(settings, 'STRIPE_PRICE_ID', '') or '').strip()
    )


def allow_local_trial() -> bool:
    """Local (no-card) trial — default on for manual GCash/admin billing."""
    raw = str(getattr(settings, 'ALLOW_LOCAL_TRIAL', 'true') or 'true').strip().lower()
    if raw in {'0', 'false', 'no', 'off'}:
        return False
    if raw in {'1', 'true', 'yes', 'on', ''}:
        return True
    return not stripe_configured()


def require_email_verify_for_trial() -> bool:
    return bool(getattr(settings, 'REQUIRE_EMAIL_VERIFY_FOR_TRIAL', False))


def get_subscriber_profile(user):
    if not user or not getattr(user, 'is_authenticated', False):
        return None
    try:
        return user.subscriber_profile
    except SubscriberProfile.DoesNotExist:
        return None


import secrets
import string

REFERRAL_BONUS_DAYS = 3


def generate_referral_code() -> str:
    chars = string.ascii_uppercase + string.digits
    for _ in range(100):
        code = 'REF' + ''.join(secrets.choice(chars) for _ in range(5))
        if not SubscriberProfile.objects.filter(referral_code=code).exists():
            return code
    return 'REF' + str(secrets.randbelow(900000) + 100000)


def ensure_subscriber_profile(user):
    profile, _ = SubscriberProfile.objects.get_or_create(user=user)
    if not profile.referral_code:
        profile.referral_code = generate_referral_code()
        profile.save(update_fields=['referral_code', 'updated_at'])
    return profile


def _expire_stale_entitlement(profile) -> None:
    """Drop trial/paid status once the period ends (back to free plan)."""
    if profile is None:
        return
    if profile.status not in ACTIVE_STATUSES:
        return

    now = timezone.now()
    if profile.manual_override_until and profile.manual_override_until > now:
        return

    ended = bool(profile.current_period_end and profile.current_period_end <= now)
    missing_period_end = profile.current_period_end is None
    if ended or missing_period_end:
        profile.status = SubscriberProfile.Status.INACTIVE
        profile.save(update_fields=['status', 'updated_at'])


def user_has_offline_access(user) -> bool:
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    if user.is_staff or user.is_superuser:
        return True

    profile = get_subscriber_profile(user)
    if profile is None:
        return False
    if profile.is_banned:
        return False

    _expire_stale_entitlement(profile)
    profile.refresh_from_db(
        fields=['status', 'current_period_end', 'manual_override_until', 'is_banned']
    )

    now = timezone.now()
    if profile.manual_override_until and profile.manual_override_until > now:
        return True

    if profile.status in ACTIVE_STATUSES:
        return bool(profile.current_period_end and profile.current_period_end > now)

    return False


def trial_available(profile) -> bool:
    if profile is None:
        return False
    if profile.is_banned or profile.trial_used:
        return False
    if require_email_verify_for_trial() and not profile.email_verified:
        return False
    if not allow_local_trial() and stripe_configured():
        if not profile.email_verified:
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
    return allow_local_trial()


def device_trial_blocked(device_id: str, user=None):
    """Return (blocked, code). Empty device is allowed for manual local trial."""
    raw = normalize_device_id(device_id)
    if not raw:
        return False, None
    device_hash = hash_device_id(raw)
    existing = TrialDevice.objects.filter(device_hash=device_hash).select_related('user').first()
    if existing is None:
        return False, None
    if user is not None and existing.user_id == getattr(user, 'pk', None):
        return False, None
    return True, 'device_used'


def bind_trial_device(user, device_id: str):
    raw = normalize_device_id(device_id)
    if not raw:
        return True, None
    device_hash = hash_device_id(raw)
    existing = TrialDevice.objects.filter(device_hash=device_hash).first()
    if existing and existing.user_id != user.pk:
        return False, 'device_used'
    if existing is None:
        TrialDevice.objects.create(device_hash=device_hash, user=user)
    return True, None


def start_free_trial(user, *, device_id: str = ''):
    """
    Manual local free trial (no card / no Stripe).
    One trial per account; optional device fingerprint when provided.
    Returns (ok, profile|None, error_code|None).
    """
    profile = ensure_subscriber_profile(user)
    _expire_stale_entitlement(profile)

    if profile.is_banned:
        return False, profile, 'banned'
    if require_email_verify_for_trial() and not profile.email_verified:
        return False, profile, 'email_unverified'
    if not allow_local_trial():
        return False, profile, 'use_stripe_trial'
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

    blocked, code = device_trial_blocked(device_id, user=user)
    if blocked:
        return False, profile, code

    ok_bind, bind_code = bind_trial_device(user, device_id)
    if not ok_bind:
        return False, profile, bind_code

    now = timezone.now()
    profile.status = SubscriberProfile.Status.TRIALING
    profile.current_period_end = now + timedelta(days=trial_days())
    profile.trial_used = True
    profile.save(
        update_fields=['status', 'current_period_end', 'trial_used', 'updated_at']
    )
    send_pass_activated_email(user, until_date=profile.current_period_end)
    return True, profile, None


def grant_manual_trial(user):
    """Admin: grant/reset a configured trial window (manual billing mode)."""
    profile = ensure_subscriber_profile(user)
    if profile.is_banned:
        return False, profile, 'banned'
    now = timezone.now()
    profile.status = SubscriberProfile.Status.TRIALING
    profile.current_period_end = now + timedelta(days=trial_days())
    profile.trial_used = True
    profile.manual_override_until = None
    profile.save(
        update_fields=[
            'status',
            'current_period_end',
            'trial_used',
            'manual_override_until',
            'updated_at',
        ]
    )
    send_pass_activated_email(user, until_date=profile.current_period_end)
    return True, profile, None


def apply_referral(new_user, referral_code: str) -> tuple[bool, str]:
    """
    Applies referral code to new_user:
    Both referrer and referee receive +3 days trial extension!
    Returns (ok, message).
    """
    code = (referral_code or '').strip().upper()
    if not code:
        return False, 'No referral code provided.'

    new_profile = ensure_subscriber_profile(new_user)
    if new_profile.referred_by_id:
        return False, 'Referral code already applied on this account.'

    referrer_profile = (
        SubscriberProfile.objects.filter(referral_code__iexact=code)
        .select_related('user')
        .first()
    )
    if not referrer_profile or not referrer_profile.user:
        return False, 'Invalid referral code.'

    if referrer_profile.user_id == new_user.id:
        return False, 'You cannot refer yourself.'

    now = timezone.now()

    # 1. Give Referee (new_user) +3 days bonus
    new_profile.referred_by = referrer_profile.user
    if new_profile.current_period_end and new_profile.current_period_end > now:
        new_profile.current_period_end += timedelta(days=REFERRAL_BONUS_DAYS)
    else:
        new_profile.current_period_end = now + timedelta(days=trial_days() + REFERRAL_BONUS_DAYS)

    new_profile.status = SubscriberProfile.Status.TRIALING
    new_profile.trial_used = True
    new_profile.save(
        update_fields=['referred_by', 'current_period_end', 'status', 'trial_used', 'updated_at']
    )

    # 2. Give Referrer +3 days bonus & update counters
    referrer_profile.referral_count += 1
    referrer_profile.referral_days_earned += REFERRAL_BONUS_DAYS

    if referrer_profile.manual_override_until and referrer_profile.manual_override_until > now:
        referrer_profile.manual_override_until += timedelta(days=REFERRAL_BONUS_DAYS)
    elif referrer_profile.current_period_end and referrer_profile.current_period_end > now:
        referrer_profile.current_period_end += timedelta(days=REFERRAL_BONUS_DAYS)
    else:
        referrer_profile.status = SubscriberProfile.Status.TRIALING
        referrer_profile.current_period_end = now + timedelta(days=REFERRAL_BONUS_DAYS)

    referrer_profile.save(
        update_fields=[
            'referral_count',
            'referral_days_earned',
            'manual_override_until',
            'current_period_end',
            'status',
            'updated_at',
        ]
    )

    return True, f'Referral applied! Both you and your friend got +{REFERRAL_BONUS_DAYS} days trial extension!'


def subscription_payload(user) -> dict:
    profile = get_subscriber_profile(user)
    days = trial_days()
    if profile is None:
        return {
            'status': SubscriberProfile.Status.INACTIVE,
            'current_period_end': None,
            'manual_override_until': None,
            'trial_used': False,
            'trial_available': False,
            'trial_days': days,
            'is_trialing': False,
            'email_verified': False,
            'is_banned': False,
            'stripe_trial': stripe_configured(),
            'local_trial_allowed': allow_local_trial(),
            'stripe_subscription_id': '',
            'days_left': None,
            'formatted_end': None,
            'status_label': 'No subscription',
            'referral_code': '',
            'referral_count': 0,
            'referral_days_earned': 0,
            'referred_by': None,
        }

    _expire_stale_entitlement(profile)
    now = timezone.now()
    is_trialing = (
        profile.status == SubscriberProfile.Status.TRIALING
        and bool(profile.current_period_end)
        and profile.current_period_end > now
    )

    end_date = profile.manual_override_until or profile.current_period_end
    formatted_end = end_date.strftime('%b %d').replace(' 0', ' ') if end_date else None

    days_left = None
    if is_trialing and profile.current_period_end and profile.current_period_end > now:
        diff = profile.current_period_end - now
        days_left = max(0, diff.days + (1 if diff.seconds > 0 else 0))

    status_label = 'Free plan'
    if is_trialing and days_left is not None:
        if days_left > 1:
            status_label = f"{days_left} days left on your trial"
        elif days_left == 1:
            status_label = "1 day left on your trial"
        else:
            status_label = "Trial ends today"
    elif profile.status == SubscriberProfile.Status.ACTIVE or (
        profile.manual_override_until and profile.manual_override_until > now
    ):
        if formatted_end:
            status_label = f"Activated until {formatted_end}"
        else:
            status_label = "Activated"
    elif profile.trial_used:
        status_label = "Trial ended"

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
        'email_verified': bool(profile.email_verified),
        'is_banned': bool(profile.is_banned),
        'stripe_trial': stripe_configured(),
        'local_trial_allowed': allow_local_trial(),
        'stripe_subscription_id': profile.stripe_subscription_id or '',
        'days_left': days_left,
        'formatted_end': formatted_end,
        'status_label': status_label,
        'referral_code': profile.referral_code or '',
        'referral_count': profile.referral_count,
        'referral_days_earned': profile.referral_days_earned,
        'referred_by': profile.referred_by.email if profile.referred_by else None,
    }
