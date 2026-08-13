"""Record catalog import/seed runs for admin refresh alerts."""

from .models import CatalogSeedLog, Song


def log_catalog_refresh(
    *,
    source,
    created=0,
    updated=0,
    skipped=0,
    deleted=0,
    note='',
):
    total = Song.objects.count()
    return CatalogSeedLog.objects.create(
        source=source,
        songs_created=max(0, int(created or 0)),
        songs_updated=max(0, int(updated or 0)),
        songs_skipped=max(0, int(skipped or 0)),
        songs_deleted=max(0, int(deleted or 0)),
        songs_total=max(0, int(total or 0)),
        note=(note or '')[:255],
    )
