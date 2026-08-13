import hashlib
import logging
import threading

from django.conf import settings
from django.core import signing
from django.core.mail import send_mail
from django.utils import timezone

from .models import SubscriberProfile

logger = logging.getLogger(__name__)

VERIFY_SALT = 'platino-email-verify-v1'
VERIFY_MAX_AGE = 60 * 60 * 48  # 48 hours


def _frontend_base() -> str:
    return (getattr(settings, 'FRONTEND_URL', '') or 'http://localhost:5173').rstrip('/')


def make_email_verify_token(user_id: int, email: str) -> str:
    return signing.dumps(
        {'uid': user_id, 'email': (email or '').strip().lower()},
        salt=VERIFY_SALT,
    )


def loads_email_verify_token(token: str):
    return signing.loads(token, salt=VERIFY_SALT, max_age=VERIFY_MAX_AGE)


def _send_mail_sync(subject, body, from_email, to_email):
    try:
        send_mail(
            subject,
            body,
            from_email,
            [to_email],
            fail_silently=False,
        )
        logger.info('Verification email sent to %s', to_email)
    except Exception:
        logger.exception('Failed to send verification email to %s', to_email)


def send_verification_email(user, *, background=True) -> dict:
    """
    Queue/send verification email.
    background=True (default): return immediately so signup never hangs on SMTP.
    """
    email = (user.email or user.username or '').strip().lower()
    if not email or '@' not in email:
        return {'sent': False, 'detail': 'No email on account.'}

    token = make_email_verify_token(user.pk, email)
    verify_url = f'{_frontend_base()}/?verify_email={token}'
    subject = 'Verify your email — Platino Offline Pass'
    body = (
        'Salamat sa pag-sign up sa Platino Songbook.\n\n'
        'I-verify ang email mo para magamit ang Offline Pass free trial:\n'
        f'{verify_url}\n\n'
        'Link expires in 48 hours. Kung hindi ikaw ang nag-sign up, ignore this email.\n'
    )

    from_email = getattr(settings, 'DEFAULT_FROM_EMAIL', '') or 'noreply@platino.local'

    profile = SubscriberProfile.objects.filter(user=user).first()
    if profile is not None:
        profile.email_verify_sent_at = timezone.now()
        profile.save(update_fields=['email_verify_sent_at', 'updated_at'])

    if background:
        threading.Thread(
            target=_send_mail_sync,
            args=(subject, body, from_email, email),
            daemon=True,
        ).start()
        sent = True  # queued
        detail = 'Verification email queued.'
    else:
        try:
            n = send_mail(subject, body, from_email, [email], fail_silently=False)
            sent = bool(n)
            detail = 'Verification email sent.' if sent else 'Could not send email.'
        except Exception:
            logger.exception('Failed to send verification email to %s', email)
            sent = False
            detail = 'Could not send email. Check SMTP settings.'

    payload = {'sent': sent, 'detail': detail, 'queued': background}
    include_link = bool(getattr(settings, 'DEBUG', False)) or bool(
        getattr(settings, 'EMAIL_INCLUDE_LINK_IN_API', False)
    )
    if include_link:
        payload['verify_url'] = verify_url
        payload['token'] = token
    return payload


def mark_email_verified(user, email: str) -> bool:
    email = (email or '').strip().lower()
    profile, _ = SubscriberProfile.objects.get_or_create(user=user)
    if profile.is_banned:
        return False
    user_email = (user.email or user.username or '').strip().lower()
    if email and email != user_email:
        return False
    profile.email_verified = True
    profile.save(update_fields=['email_verified', 'updated_at'])
    return True


def hash_device_id(raw: str) -> str:
    raw = (raw or '').strip()
    if not raw:
        return ''
    pepper = (getattr(settings, 'SECRET_KEY', '') or 'platino')[:32]
    return hashlib.sha256(f'{pepper}:{raw}'.encode('utf-8')).hexdigest()


def normalize_device_id(raw: str) -> str:
    raw = (raw or '').strip()[:128]
    if len(raw) < 8:
        return ''
    return raw


def send_pass_activated_email(user, *, until_date=None, background=True) -> dict:
    """
    Auto email sent when an Offline Pass or Free Trial is activated.
    """
    email = (user.email or user.username or '').strip().lower()
    if not email or '@' not in email:
        return {'sent': False, 'detail': 'No email on account.'}

    profile = SubscriberProfile.objects.filter(user=user).first()
    if profile and profile.is_banned:
        return {'sent': False, 'detail': 'User is banned.'}

    formatted_date = ''
    if until_date:
        formatted_date = until_date.strftime('%b %d, %Y').replace(' 0', ' ')
    elif profile and (profile.manual_override_until or profile.current_period_end):
        d = profile.manual_override_until or profile.current_period_end
        formatted_date = d.strftime('%b %d, %Y').replace(' 0', ' ')

    until_str = f'hanggang {formatted_date}' if formatted_date else 'active'

    subject = '🎤 Activated: Ang iyong Platino Offline Pass ay Handa na!'
    body = (
        'Magandang araw!\n\n'
        'Ang iyong Platino Karaoke Offline Pass ay matagumpay nang NAKAACTIVATE!\n\n'
        '📌 Details ng Access:\n'
        f'• Expiration: {until_str}\n'
        '• Features: Full Offline Songbook (~10,000 Platinum songs) + Unlimited Favorites\n\n'
        'Maaari mo nang buksan ang Platino app at i-click ang "Save Offline Catalog" para magamit ang songbook kahit walang Wi-Fi o signal sa venue.\n\n'
        f'Buksan ang App: {_frontend_base()}\n\n'
        'Salamat sa pagtangkilik sa Platino Songbook!\n'
    )

    from_email = getattr(settings, 'DEFAULT_FROM_EMAIL', '') or 'noreply@platino.local'

    if profile:
        profile.activated_email_sent_at = timezone.now()
        profile.save(update_fields=['activated_email_sent_at', 'updated_at'])

    if background:
        threading.Thread(
            target=_send_mail_sync,
            args=(subject, body, from_email, email),
            daemon=True,
        ).start()
        return {'sent': True, 'detail': 'Activation email queued.', 'queued': True}
    else:
        try:
            n = send_mail(subject, body, from_email, [email], fail_silently=False)
            return {'sent': bool(n), 'detail': 'Activation email sent.' if n else 'Could not send email.'}
        except Exception:
            logger.exception('Failed to send activation email to %s', email)
            return {'sent': False, 'detail': 'Could not send email.'}


def send_pass_expiring_email(user, *, days_left=1, background=True) -> dict:
    """
    Auto email sent when Offline Pass or Free Trial is about to expire.
    """
    email = (user.email or user.username or '').strip().lower()
    if not email or '@' not in email:
        return {'sent': False, 'detail': 'No email on account.'}

    profile = SubscriberProfile.objects.filter(user=user).first()
    if profile and profile.is_banned:
        return {'sent': False, 'detail': 'User is banned.'}

    formatted_date = ''
    if profile and (profile.manual_override_until or profile.current_period_end):
        d = profile.manual_override_until or profile.current_period_end
        formatted_date = d.strftime('%b %d, %Y').replace(' 0', ' ')

    days_str = 'ngayong araw' if days_left <= 0 else f'sa loob ng {days_left} araw'
    until_str = f' ({formatted_date})' if formatted_date else ''

    subject = f'⏳ Paalala: Malapit na mag-expire ang iyong Offline Pass{until_str}'
    body = (
        'Magandang araw!\n\n'
        f'Paalala lamang na ang iyong Platino Offline Pass ay mag-eexpire {days_str}{until_str}.\n\n'
        'Upang hindi maputol ang iyong offline catalog search at unlimited favorites:\n'
        '1. Mag-subscribe via GCash (₱149/mo) sa Account section ng app.\n'
        '2. I-send ang confirmation sa admin para ma-extend agad ang iyong pass.\n\n'
        f'I-renew o Mag-subscribe: {_frontend_base()}\n\n'
        'Manatiling handa sa susunod mong karaoke session!\n'
    )

    from_email = getattr(settings, 'DEFAULT_FROM_EMAIL', '') or 'noreply@platino.local'

    if profile:
        profile.expiring_email_sent_at = timezone.now()
        profile.save(update_fields=['expiring_email_sent_at', 'updated_at'])

    if background:
        threading.Thread(
            target=_send_mail_sync,
            args=(subject, body, from_email, email),
            daemon=True,
        ).start()
        return {'sent': True, 'detail': 'Expiring email queued.', 'queued': True}
    else:
        try:
            n = send_mail(subject, body, from_email, [email], fail_silently=False)
            return {'sent': bool(n), 'detail': 'Expiring email sent.' if n else 'Could not send email.'}
        except Exception:
            logger.exception('Failed to send expiring email to %s', email)
            return {'sent': False, 'detail': 'Could not send email.'}


def check_and_send_expiring_emails() -> int:
    """
    Scans subscriber profiles and queues reminder emails for passes expiring within 48 hours.
    Returns the number of emails queued.
    """
    from datetime import timedelta
    from django.db import models

    now = timezone.now()
    threshold = now + timedelta(hours=48)

    profiles = SubscriberProfile.objects.select_related('user').filter(
        is_banned=False,
    ).filter(
        models.Q(status__in=['active', 'trialing']) | models.Q(manual_override_until__gt=now)
    )

    count = 0
    for profile in profiles:
        end_date = profile.manual_override_until or profile.current_period_end
        if not end_date:
            continue

        if now <= end_date <= threshold:
            last_sent = profile.expiring_email_sent_at
            if last_sent and (end_date - last_sent).total_seconds() < 48 * 3600:
                continue

            diff = end_date - now
            days_left = max(0, diff.days + (1 if diff.seconds > 0 else 0))

            res = send_pass_expiring_email(profile.user, days_left=days_left, background=True)
            if res.get('sent'):
                count += 1

    return count

