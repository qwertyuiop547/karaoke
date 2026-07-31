from django.core.cache import cache


def is_rate_limited(key: str, *, limit: int, window_seconds: int) -> bool:
    """
    Simple fixed-window rate limit using Django cache.
    Returns True when the caller should be blocked.
    Fail-open on cache errors so public endpoints stay available.
    """
    if not key:
        return False
    cache_key = f'rl:{key}'
    try:
        current = cache.incr(cache_key)
    except ValueError:
        try:
            cache.set(cache_key, 1, timeout=window_seconds)
        except Exception:
            return False
        return False
    except Exception:
        return False
    return current > limit


def client_ip(request) -> str:
    forwarded = (request.META.get('HTTP_X_FORWARDED_FOR') or '').split(',')[0].strip()
    return forwarded or request.META.get('REMOTE_ADDR') or 'unknown'
