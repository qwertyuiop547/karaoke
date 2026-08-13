# Generated manually for activation and expiration auto email notifications

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0010_catalogseedlog'),
    ]

    operations = [
        migrations.AddField(
            model_name='subscriberprofile',
            name='activated_email_sent_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='subscriberprofile',
            name='expiring_email_sent_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
