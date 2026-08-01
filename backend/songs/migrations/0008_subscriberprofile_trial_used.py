# Generated manually for Offline Pass free trial

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0007_subscriberprofile'),
    ]

    operations = [
        migrations.AddField(
            model_name='subscriberprofile',
            name='trial_used',
            field=models.BooleanField(
                default=False,
                help_text='True after the account has consumed its one-time Offline Pass free trial.',
            ),
        ),
    ]
