from django.core.management.base import BaseCommand

from songs.email_verify import check_and_send_expiring_emails


class Command(BaseCommand):
    help = 'Scans active and trialing Offline Pass subscribers and sends expiration reminder emails for passes ending in <= 48h.'

    def handle(self, *args, **options):
        self.stdout.write('Checking for expiring Offline Pass subscriptions…')
        count = check_and_send_expiring_emails()
        self.stdout.write(self.style.SUCCESS(f'Successfully queued/sent {count} expiration reminder email(s).'))
