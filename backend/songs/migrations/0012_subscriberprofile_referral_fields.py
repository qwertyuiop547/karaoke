# Generated manually for Referral ("Invite a friend") system

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('songs', '0011_subscriberprofile_email_notification_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='subscriberprofile',
            name='referral_code',
            field=models.CharField(
                blank=True,
                db_index=True,
                help_text='Unique referral code for Invite a Friend bonus trial extensions.',
                max_length=32,
                null=True,
                unique=True,
            ),
        ),
        migrations.AddField(
            model_name='subscriberprofile',
            name='referred_by',
            field=models.ForeignKey(
                blank=True,
                help_text='User who invited this subscriber.',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='referrals_given',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='subscriberprofile',
            name='referral_count',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='subscriberprofile',
            name='referral_days_earned',
            field=models.PositiveIntegerField(default=0),
        ),
    ]
