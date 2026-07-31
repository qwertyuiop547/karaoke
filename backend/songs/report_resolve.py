from django.db import transaction

from .models import Song, SongReport


class ResolveError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def resolve_report(report, *, action, admin_notes='', correct_number='', title='', artist='', language='', genre=''):
    """
    Apply a resolve action to a SongReport.
    Returns (message, level) where level is success|info|warning.
    Raises ResolveError on validation failures.
    """
    song = report.song or Song.objects.filter(platinum_number=report.platinum_number).first()
    report.admin_notes = admin_notes or report.admin_notes

    with transaction.atomic():
        if action == 'reject':
            report.status = SongReport.Status.REJECTED
            report.save(update_fields=['status', 'admin_notes', 'updated_at'])
            return 'Report marked as Rejected.', 'info'

        if action == 'reviewed':
            report.status = SongReport.Status.REVIEWED
            report.save(update_fields=['status', 'admin_notes', 'updated_at'])
            return 'Report marked as Reviewed.', 'info'

        if action == 'update_number':
            if not song:
                raise ResolveError('No linked song to update. Use Delete + Add instead.')
            if not correct_number:
                raise ResolveError('Enter the correct Platinum number.')
            if (
                Song.objects.filter(platinum_number=correct_number)
                .exclude(pk=song.pk)
                .exists()
            ):
                raise ResolveError(
                    f'Number {correct_number} is already used. Pick another or delete first.'
                )

            song.platinum_number = correct_number
            if title:
                song.title = title
            if artist:
                song.artist = artist
            if language:
                song.language = language
            if genre:
                song.genre = genre
            song.save()

            report.platinum_number = correct_number
            report.title = song.title
            report.artist = song.artist
            report.status = SongReport.Status.FIXED
            report.save()
            return f'Song number updated → {correct_number}. Report marked Fixed.', 'success'

        if action == 'delete_wrong':
            if not song:
                raise ResolveError('No song available to delete.')
            deleted_number = song.platinum_number
            song.delete()
            report.song = None
            report.status = SongReport.Status.REVIEWED
            report.save(update_fields=['song', 'status', 'admin_notes', 'updated_at'])
            return (
                f'Deleted wrong song ({deleted_number}). You can add the correct entry next.',
                'warning',
            )

        if action == 'delete_and_add':
            if not correct_number or not title:
                raise ResolveError('Correct number and title are required to add a song.')

            if song:
                song.delete()
                report.song = None

            if Song.objects.filter(platinum_number=correct_number).exists():
                new_song = Song.objects.get(platinum_number=correct_number)
                new_song.title = title
                new_song.artist = artist
                new_song.language = language
                new_song.genre = genre
                new_song.save()
                created = False
            else:
                new_song = Song.objects.create(
                    platinum_number=correct_number,
                    title=title,
                    artist=artist,
                    language=language,
                    genre=genre,
                )
                created = True

            report.song = new_song
            report.platinum_number = correct_number
            report.title = title
            report.artist = artist
            report.status = SongReport.Status.FIXED
            report.save()
            verb = 'created' if created else 'updated'
            return (
                f'Deleted wrong song and {verb} correct song {correct_number} — {title}.',
                'success',
            )

        if action == 'add_correct':
            if not correct_number or not title:
                raise ResolveError('Correct number and title are required.')

            new_song, created = Song.objects.update_or_create(
                platinum_number=correct_number,
                defaults={
                    'title': title,
                    'artist': artist,
                    'language': language,
                    'genre': genre,
                },
            )
            report.song = new_song
            report.platinum_number = correct_number
            report.title = title
            report.artist = artist
            report.status = SongReport.Status.FIXED
            report.save()
            verb = 'Created' if created else 'Updated'
            return f'{verb} correct song {correct_number}. Report Fixed.', 'success'

        raise ResolveError('Unknown action.')
