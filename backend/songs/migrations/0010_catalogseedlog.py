from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0009_trial_anti_abuse'),
    ]

    operations = [
        migrations.CreateModel(
            name='CatalogSeedLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('source', models.CharField(choices=[('seed_command', 'Seed command'), ('csv_upload', 'CSV upload')], db_index=True, max_length=32)),
                ('songs_created', models.PositiveIntegerField(default=0)),
                ('songs_updated', models.PositiveIntegerField(default=0)),
                ('songs_skipped', models.PositiveIntegerField(default=0)),
                ('songs_deleted', models.PositiveIntegerField(default=0)),
                ('songs_total', models.PositiveIntegerField(default=0)),
                ('note', models.CharField(blank=True, default='', max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
