import hashlib
import logging
import threading

from django.conf import settings
from django.core import signing
from django.core.mail import send_mail
from django.utils import timezone

logger = logging.getLogger(__name__)

RESET_SALT = 'platino-password-reset-v1'
RESET_MAX_AGE = 60 * 60 * 2  # 2 hours


def _frontend_base() -> str:
    return (getattr(settings, 'FRONTEND_URL', '') or 'http://localhost:5173').rstrip('/')


def _user_pwhash_fingerprint(user) -> str:
    raw = f'{user.password or ""}'
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:24]


def make_password_reset_token(user) -> str:
    """
    Generate a signed reset token containing user ID, email, timestamp,
    and a SHA256 fingerprint of the current password hash.
    If the password is changed, old tokens immediately become invalid.
    """
    return signing.dumps(
        {
            'uid': user.pk,
            'email': (user.email or user.username or '').strip().lower(),
            'pwhash': _user_pwhash_fingerprint(user),
            'ts': timezone.now().timestamp(),
        },
        salt=RESET_SALT,
    )


def validate_password_reset_token(token: str):
    """
    Validate reset token and return (user, error_message).
    Returns (User, '') on success, or (None, 'reason') on failure.
    """
    token = (token or '').strip()
    if not token:
        return None, 'Missing reset token.'
    try:
        data = signing.loads(token, salt=RESET_SALT, max_age=RESET_MAX_AGE)
    except signing.SignatureExpired:
        return None, 'Password reset link has expired. Please request a new one.'
    except Exception:
        return None, 'Invalid password reset link.'

    uid = data.get('uid')
    pwhash = data.get('pwhash')
    if not uid:
        return None, 'Invalid password reset link.'

    from django.contrib.auth import get_user_model
    User = get_user_model()
    try:
        user = User.objects.get(pk=int(uid))
    except (User.DoesNotExist, TypeError, ValueError):
        return None, 'User account no longer exists.'

    if not user.is_active:
        return None, 'This account is deactivated.'

    if _user_pwhash_fingerprint(user) != pwhash:
        return None, 'This password reset link has already been used or is no longer valid.'

    return user, ''


def _send_mail_sync(subject, body, from_email, to_email):
    try:
        send_mail(
            subject,
            body,
            from_email,
            [to_email],
            fail_silently=False,
        )
        logger.info('Password reset email sent to %s', to_email)
    except Exception:
        logger.exception('Failed to send password reset email to %s', to_email)


def send_password_reset_email(user, *, background=True) -> dict:
    """
    Queue or send password reset email.
    background=True (default): return immediately so API request never hangs on SMTP.
    """
    email = (user.email or user.username or '').strip().lower()
    if not email or '@' not in email:
        return {'sent': False, 'detail': 'No valid email address associated with this account.'}

    token = make_password_reset_token(user)
    reset_url = f'{_frontend_base()}/?reset_token={token}'
    subject = '🔑 Reset your password — Platino Songbook'
    body = (
        'Magandang araw!\n\n'
        'May nag-request na i-reset ang password para sa iyong Platino Songbook account.\n\n'
        'I-click ang link na ito para mag-set ng bagong password:\n'
        f'{reset_url}\n\n'
        'Ang link na ito ay mag-eexpire sa loob ng 2 oras. '
        'Kung hindi ikaw ang nag-request, huwag mag-alala — mananatiling ligtas ang iyong account at maaari mong i-ignore ang mensaheng ito.\n\n'
        'Salamat!\nPlatino Songbook Team\n'
    )

    from_email = getattr(settings, 'DEFAULT_FROM_EMAIL', '') or 'noreply@platino.local'

    if background:
        threading.Thread(
            target=_send_mail_sync,
            args=(subject, body, from_email, email),
            daemon=True,
        ).start()
        sent = True
        detail = 'Password reset email queued.'
    else:
        try:
            n = send_mail(subject, body, from_email, [email], fail_silently=False)
            sent = bool(n)
            detail = 'Password reset email sent.' if sent else 'Could not send email.'
        except Exception:
            logger.exception('Failed to send password reset email to %s', email)
            sent = False
            detail = 'Could not send email. Check SMTP settings.'

    payload = {'sent': sent, 'detail': detail, 'queued': background}
    include_link = bool(getattr(settings, 'DEBUG', False)) or bool(
        getattr(settings, 'EMAIL_INCLUDE_LINK_IN_API', False)
    )
    if include_link:
        payload['reset_url'] = reset_url
        payload['token'] = token
    return payload
