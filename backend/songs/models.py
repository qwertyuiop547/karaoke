from django.conf import settings
from django.db import models


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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f'{self.user} ({self.status})'
