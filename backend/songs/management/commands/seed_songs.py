from pathlib import Path
import csv
from django.core.management.base import BaseCommand
from django.db import transaction
from songs.models import Song


# Prefer songs/data (catalog builder output); fall back to legacy backend/data.
_BASE = Path(__file__).resolve().parents[2]
_CANDIDATES = (
    _BASE / "songs" / "data" / "platinum_songs.csv",
    _BASE / "data" / "platinum_songs.csv",
)
CSV_PATH = next((p for p in _CANDIDATES if p.exists()), _CANDIDATES[0])


class Command(BaseCommand):
    help = "Load real Platinum karaoke songs from official songlist CSV"

    def add_arguments(self, parser):
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Delete existing songs before loading",
        )

    def handle(self, *args, **options):
        if not CSV_PATH.exists():
            self.stderr.write(
                self.style.ERROR(
                    f"Missing {CSV_PATH}. Run: python ../scripts/build_platinum_catalog.py"
                )
            )
            return

        rows = []
        with CSV_PATH.open(encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                number = (row.get("platinum_number") or "").strip()
                title = (row.get("title") or "").strip()
                artist = (row.get("artist") or "").strip()
                language = (row.get("language") or "").strip()
                genre = (row.get("genre") or "").strip()
                if not number or not title:
                    continue
                rows.append(
                    Song(
                        platinum_number=number,
                        title=title,
                        artist=artist,
                        language=language,
                        genre=genre,
                    )
                )

        with transaction.atomic():
            if options["replace"]:
                deleted, _ = Song.objects.all().delete()
                self.stdout.write(f"Deleted {deleted} existing song rows.")

            existing = {
                s.platinum_number: s
                for s in Song.objects.only(
                    "id", "platinum_number", "title", "artist", "language", "genre"
                )
            }
            to_create = []
            to_update = []
            for song in rows:
                prev = existing.get(song.platinum_number)
                if prev is None:
                    to_create.append(song)
                    continue
                if (
                    prev.title != song.title
                    or prev.artist != song.artist
                    or prev.language != song.language
                    or prev.genre != song.genre
                ):
                    prev.title = song.title
                    prev.artist = song.artist
                    prev.language = song.language
                    prev.genre = song.genre
                    to_update.append(prev)

            if to_create:
                Song.objects.bulk_create(to_create, batch_size=500)
            if to_update:
                Song.objects.bulk_update(
                    to_update,
                    ["title", "artist", "language", "genre"],
                    batch_size=500,
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"Seed complete. Created {len(to_create)}, updated {len(to_update)}. "
                f"Total in DB: {Song.objects.count()}"
            )
        )
