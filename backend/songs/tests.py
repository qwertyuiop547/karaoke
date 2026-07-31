from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from .models import SearchEvent, Song, SongReport


User = get_user_model()


class SongApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=False)
        self.song = Song.objects.create(
            platinum_number='1134',
            title='With A Smile',
            artist='Eraserheads',
            language='Filipino',
            genre='OPM',
        )
        self.admin = User.objects.create_superuser('admin', 'a@test.com', 'AdminPass123!')

    def test_public_list_songs(self):
        res = self.client.get('/api/songs/?page_size=10')
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(res.data['count'], 1)

    def test_search_creates_analytics_event(self):
        res = self.client.get('/api/songs/?search=Smile&page=1')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(SearchEvent.objects.filter(query='Smile').exists())

    def test_offline_pack_etag(self):
        self.client.force_login(self.admin)
        first = self.client.get('/api/songs/offline-pack/')
        self.assertEqual(first.status_code, 200)
        etag = first.get('ETag')
        self.assertTrue(etag)
        second = self.client.get('/api/songs/offline-pack/', HTTP_IF_NONE_MATCH=etag)
        self.assertEqual(second.status_code, 304)

    def test_offline_pack_requires_subscription(self):
        anon = self.client.get('/api/songs/offline-pack/')
        self.assertEqual(anon.status_code, 401)

        subscriber = User.objects.create_user('fan@test.com', 'fan@test.com', 'FanPass123!')
        self.client.force_login(subscriber)
        blocked = self.client.get('/api/songs/offline-pack/')
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.data.get('code'), 'subscription_required')

    def test_staff_can_create_song(self):
        self.client.force_login(self.admin)
        res = self.client.post(
            '/api/songs/',
            {
                'platinum_number': '99999',
                'title': 'Test Song',
                'artist': 'Tester',
                'language': 'English',
                'genre': '',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        self.assertTrue(Song.objects.filter(platinum_number='99999').exists())

    def test_guest_cannot_create_song(self):
        res = self.client.post(
            '/api/songs/',
            {'platinum_number': '1', 'title': 'Nope'},
            format='json',
        )
        self.assertIn(res.status_code, (401, 403))


class ReportAndPresenceTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=False)
        self.song = Song.objects.create(
            platinum_number='2606',
            title='My Way',
            artist='Frank Sinatra',
            language='English',
        )
        self.admin = User.objects.create_superuser('boss', 'b@test.com', 'AdminPass123!')

    def test_public_can_report(self):
        res = self.client.post(
            '/api/reports/',
            {
                'song': self.song.id,
                'platinum_number': '2606',
                'title': 'My Way',
                'note': 'Wrong number listed',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(SongReport.objects.count(), 1)

    def test_resolve_report_requires_staff(self):
        report = SongReport.objects.create(
            song=self.song,
            platinum_number='2606',
            title='My Way',
            note='Wrong number listed',
        )
        res = self.client.post(
            f'/api/reports/{report.id}/resolve/',
            {'action': 'reviewed'},
            format='json',
        )
        self.assertIn(res.status_code, (401, 403))

        self.client.force_login(self.admin)
        res = self.client.post(
            f'/api/reports/{report.id}/resolve/',
            {'action': 'reviewed'},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        report.refresh_from_db()
        self.assertEqual(report.status, SongReport.Status.REVIEWED)

    def test_presence_ping_and_online_list(self):
        res = self.client.post(
            '/api/presence/ping/',
            {'visitor_key': 'guestkey123456', 'path': 'songbook'},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data.get('ok'))

        online = self.client.get('/api/presence/online/')
        self.assertIn(online.status_code, (401, 403))

        self.client.force_login(self.admin)
        online = self.client.get('/api/presence/online/')
        self.assertEqual(online.status_code, 200)
        self.assertGreaterEqual(online.data['count'], 1)

    def test_analytics_staff_only(self):
        res = self.client.get('/api/analytics/summary/')
        self.assertIn(res.status_code, (401, 403))
        self.client.force_login(self.admin)
        res = self.client.get('/api/analytics/summary/')
        self.assertEqual(res.status_code, 200)
        self.assertIn('top_searches', res.data)


class SqlInjectionGuardTests(TestCase):
    """Regression: user input must never break queries or dump the catalog via SQLi."""

    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=False)
        self.song = Song.objects.create(
            platinum_number='1134',
            title='With A Smile',
            artist='Eraserheads',
            language='Filipino',
            genre='OPM',
        )
        self.payloads = [
            "'; DROP TABLE songs_song; --",
            "' OR '1'='1",
            "1; DELETE FROM songs_song;--",
            "Smile' UNION SELECT * FROM auth_user--",
            "%' OR 1=1--",
            "admin'--",
            "1 OR 1=1",
        ]

    def test_search_payloads_are_harmless(self):
        before = Song.objects.count()
        for payload in self.payloads:
            res = self.client.get('/api/songs/', {'search': payload, 'page_size': 10})
            self.assertEqual(res.status_code, 200, msg=payload)
            # ORM treats input as a literal string — no boolean-true dump of all rows.
            self.assertEqual(res.data['count'], 0, msg=payload)
            self.assertEqual(Song.objects.count(), before, msg=payload)

        self.assertTrue(Song.objects.filter(platinum_number='1134').exists())
        self.assertEqual(Song.objects.count(), before)

    def test_letter_and_category_injection_ignored(self):
        before = Song.objects.count()
        res = self.client.get(
            '/api/songs/',
            {'letter': "A'; DROP TABLE songs_song;--", 'category': "opm'; DROP TABLE--"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(Song.objects.count(), before)
        self.assertTrue(Song.objects.filter(platinum_number='1134').exists())

    def test_report_search_payloads_staff_safe(self):
        admin = User.objects.create_superuser('sqli', 's@test.com', 'AdminPass123!')
        SongReport.objects.create(
            song=self.song,
            platinum_number='1134',
            title='With A Smile',
            note='Wrong number listed here',
        )
        self.client.force_login(admin)
        before = SongReport.objects.count()
        for payload in self.payloads:
            res = self.client.get('/api/reports/', {'search': payload})
            self.assertEqual(res.status_code, 200, msg=payload)
            self.assertEqual(SongReport.objects.count(), before, msg=payload)


class SubscriptionOfflineTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=False)
        Song.objects.create(
            platinum_number='77',
            title='Offline Only',
            artist='Tester',
            language='English',
        )
        self.user = User.objects.create_user('owner@venue.com', 'owner@venue.com', 'OwnerPass123!')

    def test_manual_override_unlocks_pack(self):
        from datetime import timedelta

        from django.utils import timezone

        from .entitlements import ensure_subscriber_profile

        profile = ensure_subscriber_profile(self.user)
        profile.manual_override_until = timezone.now() + timedelta(days=30)
        profile.save()

        self.client.force_login(self.user)
        res = self.client.get('/api/songs/offline-pack/')
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(res.data['count'], 1)

    def test_register_and_me_payload(self):
        res = self.client.post(
            '/api/auth/register/',
            {
                'email': 'new@venue.com',
                'password': 'NewPass123!',
                'confirm_password': 'NewPass123!',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.data['authenticated'])
        self.assertFalse(res.data['offline_access'])
        me = self.client.get('/api/auth/me/')
        self.assertTrue(me.data['authenticated'])
        self.assertEqual(me.data['email'], 'new@venue.com')
