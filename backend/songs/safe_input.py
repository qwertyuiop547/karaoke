"""Input guards for public query params (defense-in-depth vs injection / abuse)."""

from __future__ import annotations

from .models import SongReport

# Cap free-text search so payloads cannot bloat queries / caches.
MAX_SEARCH_LEN = 120

ALLOWED_SONG_CATEGORIES = frozenset({'', 'all', 'opm', 'english'})
ALLOWED_REPORT_STATUSES = frozenset(
    {'all', *(choice.value for choice in SongReport.Status)}
)


def clean_search(value: str | None, *, max_len: int = MAX_SEARCH_LEN) -> str:
    return (value or '').strip()[:max_len]


def clean_letter(value: str | None) -> str:
    letter = (value or '').strip().upper()
    if letter in ('', 'ALL'):
        return 'ALL'
    if len(letter) == 1 and letter.isalpha():
        return letter
    return 'ALL'


def clean_song_category(value: str | None) -> str:
    category = (value or '').strip().lower()
    if category in ALLOWED_SONG_CATEGORIES:
        return '' if category in ('', 'all') else category
    return ''


def clean_report_status(value: str | None) -> str:
    status = (value or '').strip().lower()
    if status in ALLOWED_REPORT_STATUSES:
        return status
    return 'all'
