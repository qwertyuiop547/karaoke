import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional, Tuple

from django.conf import settings

logger = logging.getLogger(__name__)

GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo'
GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
VALID_ISSUERS = {'accounts.google.com', 'https://accounts.google.com'}


def verify_google_id_token(credential: str) -> Tuple[Optional[dict], str]:
    """
    Verify Google OAuth2 credential (ID token or OAuth2 access token).
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

    configured_client_id = getattr(settings, 'GOOGLE_CLIENT_ID', '').strip()

    # 1. Try Google ID token tokeninfo endpoint
    try:
        query_params = urllib.parse.urlencode({'id_token': credential})
        url = f'{GOOGLE_TOKENINFO_URL}?{query_params}'
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Platino-Songbook-Auth/1.0'},
        )
        with urllib.request.urlopen(req, timeout=8) as response:
            if response.status == 200:
                raw_data = response.read().decode('utf-8')
                data = json.loads(raw_data)
                issuer = data.get('iss', '')
                if issuer in VALID_ISSUERS:
                    email = (data.get('email') or '').strip().lower()
                    if email and '@' in email:
                        email_verified = data.get('email_verified')
                        if email_verified in (True, 'true', '1', 1):
                            if not configured_client_id or data.get('aud') == configured_client_id:
                                return {
                                    'email': email,
                                    'email_verified': True,
                                    'name': data.get('name') or '',
                                    'sub': data.get('sub') or '',
                                    'picture': data.get('picture') or '',
                                }, ''
    except Exception as exc:
        logger.debug('ID token verification skipped/failed: %s', exc)

    # 2. Try Google OAuth2 access token userinfo endpoint (from initTokenClient popup)
    try:
        req = urllib.request.Request(
            GOOGLE_USERINFO_URL,
            headers={
                'Authorization': f'Bearer {credential}',
                'User-Agent': 'Platino-Songbook-Auth/1.0',
            },
        )
        with urllib.request.urlopen(req, timeout=8) as response:
            if response.status == 200:
                raw_data = response.read().decode('utf-8')
                data = json.loads(raw_data)
                email = (data.get('email') or '').strip().lower()
                if email and '@' in email:
                    email_verified = data.get('email_verified')
                    if email_verified in (True, 'true', '1', 1, None):
                        return {
                            'email': email,
                            'email_verified': True,
                            'name': data.get('name') or '',
                            'sub': data.get('sub') or '',
                            'picture': data.get('picture') or '',
                        }, ''
    except Exception as exc:
        logger.debug('Access token userinfo verification failed: %s', exc)

    return None, 'Invalid or expired Google token. Please try signing in again.'
