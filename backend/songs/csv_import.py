import csv
import io


def import_songs_csv(file_obj):
    """
    Upsert songs from a CSV upload.
    Required headers: platinum_number, title
    Optional: artist, language, genre
    Returns dict with created/updated/skipped or raises ValueError.
    """
    from .models import Song

    try:
        decoded = file_obj.read().decode('utf-8-sig')
    except UnicodeDecodeError as exc:
        raise ValueError('UTF-8 CSV only is supported.') from exc

    reader = csv.DictReader(io.StringIO(decoded))
    required = {'platinum_number', 'title'}
    if not reader.fieldnames or not required.issubset(
        {(h or '').strip().lower() for h in reader.fieldnames}
    ):
        raise ValueError(
            'CSV headers required: platinum_number, title, artist, language, genre'
        )

    field_map = {(h or '').strip().lower(): h for h in reader.fieldnames}

    created = 0
    updated = 0
    skipped = 0
    for row in reader:

        def get(key, default=''):
            original = field_map.get(key)
            if not original:
                return default
            return (row.get(original) or default).strip()

        number = get('platinum_number')[:32]
        title = get('title')[:255]
        if not number or not title:
            skipped += 1
            continue

        _, was_created = Song.objects.update_or_create(
            platinum_number=number,
            defaults={
                'title': title,
                'artist': get('artist')[:255],
                'language': get('language')[:64],
                'genre': get('genre')[:64],
            },
        )
        if was_created:
            created += 1
        else:
            updated += 1

    return {'created': created, 'updated': updated, 'skipped': skipped}
