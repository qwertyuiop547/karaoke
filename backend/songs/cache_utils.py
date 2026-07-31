"""Shared song list cache helpers (version-bump invalidation)."""

from __future__ import annotations

import hashlib

from django.conf import settings
from django.core.cache import cache

SONG_LIST_VER_KEY = 'songs:list:ver'


def song_list_cache_version() -> int:
    ver = cache.get(SONG_LIST_VER_KEY)
    if ver is None:
        cache.set(SONG_LIST_VER_KEY, 1, timeout=None)
        return 1
    return int(ver)


def bust_song_list_cache() -> None:
    try:
        cache.incr(SONG_LIST_VER_KEY)
    except ValueError:
        cache.set(SONG_LIST_VER_KEY, 1, timeout=None)


def song_list_cache_key(query_string: str) -> str:
    digest = hashlib.md5((query_string or '').encode('utf-8')).hexdigest()
    return f'songs:list:v{song_list_cache_version()}:{digest}'


def song_list_cache_ttl() -> int:
    return int(getattr(settings, 'SONG_LIST_CACHE_TTL', 20))
