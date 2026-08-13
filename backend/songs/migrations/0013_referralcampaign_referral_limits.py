# Generated manually for Admin Referral Campaign & Limit controls

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0012_subscriberprofile_referral_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='subscriberprofile',
            name='referral_max_redeems',
            field=models.PositiveIntegerField(
                default=0,
                help_text='Max redeems allowed for this user code (0 = unlimited).',
            ),
        ),
        migrations.AddField(
            model_name='subscriberprofile',
            name='referral_valid_until',
            field=models.DateTimeField(
                blank=True,
                help_text='Optional expiration date for this user referral code.',
                null=True,
            ),
        ),
        migrations.CreateModel(
            name='ReferralCampaign',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(db_index=True, max_length=64, unique=True)),
                ('title', models.CharField(blank=True, default='', max_length=128)),
                ('bonus_days', models.PositiveIntegerField(default=3, help_text='Trial bonus days granted on redeem.')),
                ('max_redeems', models.PositiveIntegerField(default=0, help_text='Max total redeems allowed (0 = unlimited).')),
                ('redeem_count', models.PositiveIntegerField(default=0, help_text='Current total redeems.')),
                ('valid_until', models.DateTimeField(blank=True, help_text='Expiration date for this campaign.', null=True)),
                ('is_active', models.BooleanField(default=True, help_text='Enable/disable code.')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
