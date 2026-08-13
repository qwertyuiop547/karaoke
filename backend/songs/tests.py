from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
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
        self.assertTrue(res.data['offline_access'])
        self.assertTrue(res.data['subscription']['is_trialing'])
        me = self.client.get('/api/auth/me/')
        self.assertTrue(me.data['authenticated'])
        self.assertEqual(me.data['email'], 'new@venue.com')
        self.assertTrue(me.data['offline_access'])

    def test_expired_trial_loses_offline_access(self):
        from datetime import timedelta

        from django.utils import timezone

        from .entitlements import ensure_subscriber_profile, user_has_offline_access

        profile = ensure_subscriber_profile(self.user)
        profile.status = profile.Status.TRIALING
        profile.current_period_end = timezone.now() - timedelta(minutes=1)
        profile.trial_used = True
        profile.save()

        self.assertFalse(user_has_offline_access(self.user))
        profile.refresh_from_db()
        self.assertEqual(profile.status, profile.Status.INACTIVE)

        self.client.force_login(self.user)
        blocked = self.client.get('/api/songs/offline-pack/')
        self.assertEqual(blocked.status_code, 403)
        me = self.client.get('/api/auth/me/')
        self.assertFalse(me.data['offline_access'])
        self.assertFalse(me.data['subscription']['is_trialing'])
        self.assertEqual(me.data['subscription']['status'], 'inactive')

    @override_settings(OFFLINE_TRIAL_DAYS=3)
    def test_free_trial_expires_after_three_days(self):
        """The local trial must always receive a finite three-day expiry."""
        from django.utils import timezone

        from .entitlements import start_free_trial

        started_at = timezone.now()
        started, profile, code = start_free_trial(self.user)

        self.assertTrue(started, code)
        self.assertEqual(profile.status, profile.Status.TRIALING)
        self.assertGreaterEqual(profile.current_period_end, started_at + timedelta(days=3))
        self.assertLess(profile.current_period_end, timezone.now() + timedelta(days=3, minutes=1))

    def test_expired_trial_remains_locked_after_login(self):
        """A new session must not revive an expired trial as an Offline Pass."""
        from datetime import timedelta

        from django.utils import timezone

        from .entitlements import ensure_subscriber_profile

        profile = ensure_subscriber_profile(self.user)
        profile.status = profile.Status.TRIALING
        profile.current_period_end = timezone.now() - timedelta(minutes=1)
        profile.trial_used = True
        profile.save()

        self.client.logout()
        login = self.client.post(
            '/api/auth/subscriber-login/',
            {'email': self.user.email, 'password': 'OwnerPass123!'},
            format='json',
        )

        self.assertEqual(login.status_code, 200)
        self.assertTrue(login.data['authenticated'])
        self.assertFalse(login.data['offline_access'])
        self.assertFalse(login.data['subscription']['is_trialing'])
        self.assertEqual(login.data['subscription']['status'], 'inactive')

    def test_open_ended_active_record_does_not_grant_pass(self):
        """Only a manual override may grant access without a billing period end."""
        from .entitlements import ensure_subscriber_profile, user_has_offline_access

        profile = ensure_subscriber_profile(self.user)
        profile.status = profile.Status.ACTIVE
        profile.current_period_end = None
        profile.manual_override_until = None
        profile.save()

        self.assertFalse(user_has_offline_access(self.user))
        profile.refresh_from_db()
        self.assertEqual(profile.status, profile.Status.INACTIVE)

    def test_verification_link_switches_to_the_verified_account(self):
        """Verification must not return one account while retaining another session."""
        from .email_verify import make_email_verify_token
        from .entitlements import ensure_subscriber_profile

        other = User.objects.create_user(
            'other@venue.com',
            'other@venue.com',
            'OtherPass123!',
        )
        ensure_subscriber_profile(other)
        token = make_email_verify_token(other.pk, other.email)

        self.client.force_login(self.user)
        response = self.client.post('/api/auth/verify-email/', {'token': token}, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['email'], other.email)
        me = self.client.get('/api/auth/me/')
        self.assertEqual(me.data['email'], other.email)

    def test_expired_active_period_loses_offline_access(self):
        from datetime import timedelta

        from django.utils import timezone

        from .entitlements import ensure_subscriber_profile, user_has_offline_access

        profile = ensure_subscriber_profile(self.user)
        profile.status = profile.Status.ACTIVE
        profile.current_period_end = timezone.now() - timedelta(hours=1)
        profile.trial_used = True
        profile.save()

        self.assertFalse(user_has_offline_access(self.user))
        profile.refresh_from_db()
        self.assertEqual(profile.status, profile.Status.INACTIVE)


class CatalogRefreshTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=False)
        self.admin = User.objects.create_superuser('admin', 'a@test.com', 'AdminPass123!')
        Song.objects.create(
            platinum_number='1001',
            title='Refresh Test',
            artist='Tester',
        )

    def test_analytics_includes_catalog_refresh(self):
        from .catalog_refresh import log_catalog_refresh
        from .models import CatalogSeedLog

        log_catalog_refresh(
            source=CatalogSeedLog.Source.SEED_COMMAND,
            created=2,
            updated=1,
            note='test.csv',
        )
        self.client.force_login(self.admin)
        res = self.client.get('/api/analytics/summary/')
        self.assertEqual(res.status_code, 200)
        refresh = res.data.get('catalog_refresh')
        self.assertIsNotNone(refresh)
        self.assertIsNotNone(refresh.get('latest'))
        self.assertEqual(refresh['latest']['songs_created'], 2)
        self.assertEqual(refresh['latest']['songs_updated'], 1)
        self.assertGreaterEqual(len(refresh.get('recent') or []), 1)


class CatalogRefreshTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=False)
        self.admin = User.objects.create_superuser('admin', 'a@test.com', 'AdminPass123!')
        Song.objects.create(
            platinum_number='1001',
            title='Refresh Test',
            artist='Tester',
        )

    def test_analytics_includes_catalog_refresh(self):
        from .catalog_refresh import log_catalog_refresh
        from .models import CatalogSeedLog

        log_catalog_refresh(
            source=CatalogSeedLog.Source.SEED_COMMAND,
            created=2,
            updated=1,
            note='test.csv',
        )
        self.client.force_login(self.admin)
        res = self.client.get('/api/analytics/summary/')
        self.assertEqual(res.status_code, 200)
        refresh = res.data.get('catalog_refresh')
        self.assertIsNotNone(refresh)
        self.assertIsNotNone(refresh.get('latest'))
        self.assertEqual(refresh['latest']['songs_created'], 2)
        self.assertEqual(refresh['latest']['songs_updated'], 1)
        self.assertGreaterEqual(len(refresh.get('recent') or []), 1)


class EmailNotificationTests(TestCase):
    def setUp(self):
        cache.clear()
        from django.core import mail
        mail.outbox.clear()
        self.client = APIClient(enforce_csrf_checks=False)
        self.user = User.objects.create_user('subscriber@test.com', 'subscriber@test.com', 'SubPass123!')
        self.admin = User.objects.create_superuser('adminboss', 'boss@test.com', 'AdminPass123!')
        mail.outbox.clear()

    def test_send_pass_activated_email(self):
        from django.core import mail
        from .email_verify import send_pass_activated_email

        res = send_pass_activated_email(self.user, background=False)
        self.assertTrue(res['sent'])
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('Activated', mail.outbox[0].subject)
        self.assertIn('subscriber@test.com', mail.outbox[0].to)

    def test_send_pass_expiring_email(self):
        from django.core import mail
        from .email_verify import send_pass_expiring_email

        res = send_pass_expiring_email(self.user, days_left=1, background=False)
        self.assertTrue(res['sent'])
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('expire', mail.outbox[0].subject)

    def test_check_and_send_expiring_emails(self):
        from datetime import timedelta
        from django.core import mail
        from django.utils import timezone
        from .email_verify import check_and_send_expiring_emails
        from .entitlements import ensure_subscriber_profile

        profile = ensure_subscriber_profile(self.user)
        profile.status = profile.Status.TRIALING
        profile.current_period_end = timezone.now() + timedelta(hours=24)
        profile.save()

        count = check_and_send_expiring_emails()
        self.assertGreaterEqual(count, 1)


class ReferralSystemTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=False)
        self.referrer = User.objects.create_user('referrer@test.com', 'referrer@test.com', 'Pass123!')
        self.referee = User.objects.create_user('referee@test.com', 'referee@test.com', 'Pass123!')

    def test_referral_code_generated(self):
        from .entitlements import ensure_subscriber_profile
        p1 = ensure_subscriber_profile(self.referrer)
        self.assertTrue(p1.referral_code.startswith('REF'))

    def test_apply_referral_success(self):
        from .entitlements import apply_referral, ensure_subscriber_profile
        p_ref = ensure_subscriber_profile(self.referrer)
        code = p_ref.referral_code

        ok, msg = apply_referral(self.referee, code)
        self.assertTrue(ok)
        self.assertIn('+3 days', msg)

        p_ref.refresh_from_db()
        p_ree = ensure_subscriber_profile(self.referee)

        self.assertEqual(p_ref.referral_count, 1)
        self.assertEqual(p_ref.referral_days_earned, 3)
        self.assertEqual(p_ree.referred_by, self.referrer)

    def test_cannot_refer_self(self):
        from .entitlements import apply_referral, ensure_subscriber_profile
        p = ensure_subscriber_profile(self.referrer)
        ok, msg = apply_referral(self.referrer, p.referral_code)
        self.assertFalse(ok)
        self.assertIn('cannot refer yourself', msg)

    def test_apply_referral_api(self):
        from .entitlements import ensure_subscriber_profile
        p_ref = ensure_subscriber_profile(self.referrer)

        self.client.force_authenticate(user=self.referee)
        res = self.client.post('/api/subscribers/apply-referral/', {'referral_code': p_ref.referral_code})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['ok'])


class ReferralCampaignTests(TestCase):
    def setUp(self):
        from django.core import mail
        mail.outbox = []
        self.admin = User.objects.create_superuser('admin_campaign', 'admin@example.com', 'pass123')
        self.user1 = User.objects.create_user('camp_user1', 'u1@example.com', 'pass123')
        self.user2 = User.objects.create_user('camp_user2', 'u2@example.com', 'pass123')

    def test_admin_create_campaign_api(self):
        self.client.force_login(self.admin)
        res = self.client.post('/api/billing/admin-referral-campaigns/', {
            'code': 'PROMO7',
            'title': '7 Days Promo',
            'bonus_days': 7,
            'max_redeems': 5,
        })
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['ok'])
        self.assertEqual(res.data['campaign']['code'], 'PROMO7')

    def test_campaign_redeem_limit(self):
        from .models import ReferralCampaign
        from .entitlements import apply_referral

        ReferralCampaign.objects.create(
            code='LIMIT1',
            bonus_days=5,
            max_redeems=1,
            is_active=True,
        )

        ok1, msg1 = apply_referral(self.user1, 'LIMIT1')
        self.assertTrue(ok1)
        self.assertIn('+5 days', msg1)

        ok2, msg2 = apply_referral(self.user2, 'LIMIT1')
        self.assertFalse(ok2)
        self.assertIn('maximum redeem limit', msg2)

    def test_campaign_expired(self):
        from .models import ReferralCampaign
        from .entitlements import apply_referral
        from django.utils import timezone
        from datetime import timedelta

        ReferralCampaign.objects.create(
            code='EXPIRED1',
            bonus_days=10,
            valid_until=timezone.now() - timedelta(days=1),
            is_active=True,
        )

        ok, msg = apply_referral(self.user1, 'EXPIRED1')
        self.assertFalse(ok)
        self.assertIn('has expired', msg)



