from django.conf import settings
from django.db import models
from django.utils import timezone


class Song(models.Model):
    title = models.CharField(max_length=255, db_index=True)
    artist = models.CharField(max_length=255, blank=True, db_index=True)
    platinum_number = models.CharField(max_length=32, unique=True, db_index=True)
    language = models.CharField(max_length=64, blank=True, default='', db_index=True)
    genre = models.CharField(max_length=64, blank=True, default='', db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['title', 'artist']
        indexes = [
            models.Index(fields=['title', 'artist']),
        ]

    def __str__(self):
        return f'{self.platinum_number} — {self.title} ({self.artist})'


class SongReport(models.Model):
    class Status(models.TextChoices):
        OPEN = 'open', 'Open'
        REVIEWED = 'reviewed', 'Reviewed'
        FIXED = 'fixed', 'Fixed'
        REJECTED = 'rejected', 'Rejected'

    song = models.ForeignKey(
        Song,
        on_delete=models.SET_NULL,
        related_name='reports',
        null=True,
        blank=True,
        help_text='Linked song (null if already deleted).',
    )
    admin_notes = models.TextField(blank=True, default='')
    platinum_number = models.CharField(max_length=32, db_index=True)
    title = models.CharField(max_length=255, blank=True, default='')
    artist = models.CharField(max_length=255, blank=True, default='')
    suggested_number = models.CharField(max_length=32, blank=True, default='')
    note = models.TextField(blank=True, default='')
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.OPEN,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', '-created_at']),
        ]

    def __str__(self):
        return f'Report {self.platinum_number} ({self.status})'


class VisitorPresence(models.Model):
    """Lightweight heartbeat presence for songbook / admin visitors."""

    visitor_key = models.CharField(max_length=64, unique=True, db_index=True)
    display_name = models.CharField(max_length=80, blank=True, default='')
    role = models.CharField(max_length=20, blank=True, default='guest')  # guest | admin
    path = models.CharField(max_length=120, blank=True, default='')
    user_agent = models.CharField(max_length=255, blank=True, default='')
    last_seen = models.DateTimeField(auto_now=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-last_seen']

    def __str__(self):
        return f'{self.display_name or self.visitor_key} ({self.role})'


class SearchEvent(models.Model):
    """Anonymous search analytics for the public songbook."""

    query = models.CharField(max_length=255, blank=True, default='', db_index=True)
    letter = models.CharField(max_length=8, blank=True, default='ALL')
    category = models.CharField(max_length=32, blank=True, default='ALL')
    result_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['query', '-created_at']),
        ]

    def __str__(self):
        return f'{self.query or self.letter}/{self.category} ({self.result_count})'


class SubscriberProfile(models.Model):
    """Billing entitlement for offline catalog access."""

    class Status(models.TextChoices):
        INACTIVE = 'inactive', 'Inactive'
        TRIALING = 'trialing', 'Trialing'
        ACTIVE = 'active', 'Active'
        PAST_DUE = 'past_due', 'Past due'
        CANCELED = 'canceled', 'Canceled'

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='subscriber_profile',
    )
    stripe_customer_id = models.CharField(max_length=255, blank=True, default='', db_index=True)
    stripe_subscription_id = models.CharField(max_length=255, blank=True, default='', db_index=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.INACTIVE,
        db_index=True,
    )
    current_period_end = models.DateTimeField(null=True, blank=True)
    manual_override_until = models.DateTimeField(
        null=True,
        blank=True,
        help_text='Admin-granted offline access until this datetime (GCash/bank fallback).',
    )
    trial_used = models.BooleanField(
        default=False,
        help_text='True after the account has consumed its one-time Offline Pass free trial.',
    )
    email_verified = models.BooleanField(default=False)
    email_verify_sent_at = models.DateTimeField(null=True, blank=True)
    activated_email_sent_at = models.DateTimeField(null=True, blank=True)
    expiring_email_sent_at = models.DateTimeField(null=True, blank=True)
    referral_code = models.CharField(
        max_length=32,
        unique=True,
        null=True,
        blank=True,
        db_index=True,
        help_text='Unique referral code for Invite a Friend bonus trial extensions.',
    )
    referred_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='referrals_given',
        help_text='User who invited this subscriber.',
    )
    referral_count = models.PositiveIntegerField(default=0)
    referral_days_earned = models.PositiveIntegerField(default=0)
    referral_max_redeems = models.PositiveIntegerField(
        default=0,
        help_text='Max redeems allowed for this user code (0 = unlimited).',
    )
    referral_valid_until = models.DateTimeField(
        null=True,
        blank=True,
        help_text='Optional expiration date for this user referral code.',
    )
    is_banned = models.BooleanField(
        default=False,
        db_index=True,
        help_text='Admin kill switch — blocks offline access and new trials.',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f'{self.user} ({self.status})'


class ReferralCampaign(models.Model):
    """
    Admin-managed referral & promo campaigns.
    Admin can set bonus trial days, max redeem count limit, expiration date, and active toggle.
    """
    code = models.CharField(max_length=64, unique=True, db_index=True)
    title = models.CharField(max_length=128, blank=True, default='')
    bonus_days = models.PositiveIntegerField(default=3, help_text='Trial bonus days granted on redeem.')
    max_redeems = models.PositiveIntegerField(default=0, help_text='Max total redeems allowed (0 = unlimited).')
    redeem_count = models.PositiveIntegerField(default=0, help_text='Current total redeems.')
    valid_until = models.DateTimeField(null=True, blank=True, help_text='Expiration date for this campaign.')
    is_active = models.BooleanField(default=True, help_text='Enable/disable code.')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.code} (+{self.bonus_days}d, {self.redeem_count}/{self.max_redeems or "∞"})'

    def check_validity(self):
        if not self.is_active:
            return False, 'This referral campaign is inactive.'
        if self.valid_until and timezone.now() > self.valid_until:
            return False, 'This referral code has expired.'
        if self.max_redeems > 0 and self.redeem_count >= self.max_redeems:
            return False, 'This referral code has reached its maximum redeem limit.'
        return True, 'Valid'


class CatalogSeedLog(models.Model):
    """Audit trail when the Platinum catalog is seeded or uploaded."""

    class Source(models.TextChoices):
        SEED_COMMAND = 'seed_command', 'Seed command'
        CSV_UPLOAD = 'csv_upload', 'CSV upload'

    source = models.CharField(max_length=32, choices=Source.choices, db_index=True)
    songs_created = models.PositiveIntegerField(default=0)
    songs_updated = models.PositiveIntegerField(default=0)
    songs_skipped = models.PositiveIntegerField(default=0)
    songs_deleted = models.PositiveIntegerField(default=0)
    songs_total = models.PositiveIntegerField(default=0)
    note = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return (
            f'{self.get_source_display()} · +{self.songs_created} '
            f'~{self.songs_updated} ({self.songs_total} total)'
        )


class TrialDevice(models.Model):
    """One free trial per device fingerprint (anti multi-account abuse)."""

    device_hash = models.CharField(max_length=64, unique=True, db_index=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='trial_devices',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.device_hash[:12]}… → {self.user_id}'

