import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional, Tuple

from django.conf import settings

logger = logging.getLogger(__name__)

GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo'
VALID_ISSUERS = {'accounts.google.com', 'https://accounts.google.com'}


def verify_google_id_token(credential: str) -> Tuple[Optional[dict], str]:
    """
    Verify Google OAuth2 ID token using Google's tokeninfo endpoint.
    Returns (payload, '') on success or (None, error_message) on failure.
    """
    credential = (credential or '').strip()
    if not credential:
        return None, 'Missing Google credential token.'

    # Test / Mock hook for offline testing and deterministic CI
    if credential.startswith('test-google-token:'):
        parts = credential.split(':', 2)
        email = parts[1].strip().lower() if len(parts) > 1 else ''
        name = parts[2].strip() if len(parts) > 2 else 'Test User'
        if not email or '@' not in email:
            return None, 'Invalid test email in token.'
        return {
            'email': email,
            'email_verified': True,
            'name': name,
            'sub': f'test-sub-{email}',
            'picture': '',
        }, ''

    try:
        query_params = urllib.parse.urlencode({'id_token': credential})
        url = f'{GOOGLE_TOKENINFO_URL}?{query_params}'
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Platino-Songbook-Auth/1.0'},
        )
        with urllib.request.urlopen(req, timeout=8) as response:
            if response.status != 200:
                return None, 'Could not verify token with Google.'
            raw_data = response.read().decode('utf-8')
            data = json.loads(raw_data)
    except urllib.error.HTTPError as exc:
        logger.warning('Google token verification HTTP error: %s', exc.code)
        try:
            err_body = json.loads(exc.read().decode('utf-8'))
            err_desc = err_body.get('error_description') or err_body.get('error')
            if err_desc:
                return None, f'Google verification failed: {err_desc}'
        except Exception:
            pass
        return None, 'Invalid or expired Google credential.'
    except Exception as exc:
        logger.exception('Google token verification failed: %s', exc)
        return None, 'Could not connect to Google verification services.'

    issuer = data.get('iss', '')
    if issuer not in VALID_ISSUERS:
        return None, 'Invalid Google token issuer.'

    email = (data.get('email') or '').strip().lower()
    if not email or '@' not in email:
        return None, 'No valid email provided by Google account.'

    email_verified = data.get('email_verified')
    if email_verified not in (True, 'true', '1', 1):
        return None, 'Google account email is not verified.'

    configured_client_id = getattr(settings, 'GOOGLE_CLIENT_ID', '').strip()
    if configured_client_id:
        audience = data.get('aud', '')
        if audience != configured_client_id:
            logger.warning(
                'Google token audience mismatch: expected %s, got %s',
                configured_client_id,
                audience,
            )
            return None, 'Google token was not issued for this application.'

    return {
        'email': email,
        'email_verified': True,
        'name': data.get('name') or '',
        'sub': data.get('sub') or '',
        'picture': data.get('picture') or '',
    }, ''
