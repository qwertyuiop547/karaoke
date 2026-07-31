"""Redis/cache-backed live presence (no Postgres write per heartbeat)."""

from __future__ import annotations

from datetime import timezone as dt_timezone

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from django.utils.dateparse import parse_datetime

PRESENCE_INDEX_KEY = 'presence:index'
PRESENCE_KEY_PREFIX = 'presence:v:'
ONLINE_CAP = 200


def _ttl() -> int:
    return int(getattr(settings, 'PRESENCE_TTL_SECONDS', 90))


def _presence_key(visitor_key: str) -> str:
    return f'{PRESENCE_KEY_PREFIX}{visitor_key}'


def set_presence(
    visitor_key: str,
    *,
    display_name: str,
    role: str,
    path: str,
    user_agent: str,
) -> dict:
    now = timezone.now()
    payload = {
        'visitor_key': visitor_key,
        'display_name': display_name,
        'role': role,
        'path': path,
        'user_agent': user_agent,
        'last_seen': now.isoformat(),
    }
    ttl = _ttl()
    cache.set(_presence_key(visitor_key), payload, ttl)

    index = cache.get(PRESENCE_INDEX_KEY) or []
    if not isinstance(index, list):
        index = list(index)
    if visitor_key not in index:
        index.append(visitor_key)
        # Cap index growth; online list also caps results.
        if len(index) > 8000:
            index = index[-6000:]
    cache.set(PRESENCE_INDEX_KEY, index, ttl * 4)

    return payload


def list_online(*, limit: int = ONLINE_CAP) -> list[dict]:
    index = cache.get(PRESENCE_INDEX_KEY) or []
    if not isinstance(index, list):
        index = list(index)

    now = timezone.now()
    ttl = _ttl()
    alive = []
    stale_keys = []

    for visitor_key in index:
        payload = cache.get(_presence_key(visitor_key))
        if not payload:
            stale_keys.append(visitor_key)
            continue
        last_seen_raw = payload.get('last_seen')
        last_seen = parse_datetime(last_seen_raw) if isinstance(last_seen_raw, str) else None
        if last_seen is None:
            stale_keys.append(visitor_key)
            continue
        if timezone.is_naive(last_seen):
            last_seen = timezone.make_aware(last_seen, dt_timezone.utc)
        age = (now - last_seen).total_seconds()
        if age > ttl:
            stale_keys.append(visitor_key)
            continue
        payload = dict(payload)
        payload['seconds_ago'] = max(0, int(age))
        payload['last_seen'] = last_seen.isoformat()
        alive.append(payload)

    if stale_keys:
        remaining = [k for k in index if k not in set(stale_keys)]
        cache.set(PRESENCE_INDEX_KEY, remaining, ttl * 4)

    alive.sort(key=lambda row: row.get('seconds_ago', 0))
    return alive[:limit]
