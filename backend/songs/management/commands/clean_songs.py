from django.core.management.base import BaseCommand
from songs.models import Song
import re


class Command(BaseCommand):
    help = "Remove obvious PDF-parse junk so only real Platinum song rows remain"

    def handle(self, *args, **options):
        deleted_ids = []

        for song in Song.objects.iterator():
            title = (song.title or "").strip()
            artist = (song.artist or "").strip()

            drop = False

            if len(title) < 2 or len(artist) < 2:
                drop = True
            elif artist.lower() == "unknown":
                drop = True
            elif re.fullmatch(r"\([^)]{0,40}\)", title):
                # Pure fragment titles like "(Frozen OST)", "(Piano Version)"
                drop = True
            elif re.search(r"\b\d{4,5}\b", artist):
                # Artist field swallowed another song code during PDF parse
                drop = True

            if drop:
                deleted_ids.append(song.id)

        count, _ = Song.objects.filter(id__in=deleted_ids).delete()
        self.stdout.write(
            self.style.SUCCESS(
                f"Removed {count} junk rows. Remaining: {Song.objects.count()}"
            )
        )
