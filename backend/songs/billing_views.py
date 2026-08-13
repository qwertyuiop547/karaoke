import logging
from datetime import datetime, timezone as dt_timezone

try:
    import stripe
except ImportError:
    stripe = None
from django.conf import settings
from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .email_verify import (
    check_and_send_expiring_emails,
    send_pass_activated_email,
    send_pass_expiring_email,
)
from .entitlements import (
    bind_trial_device,
    device_trial_blocked,
    ensure_subscriber_profile,
    grant_manual_trial,
    start_free_trial,
    stripe_configured,
    subscription_payload,
    trial_days,
    user_has_offline_access,
)
from .models import ReferralCampaign, SubscriberProfile
from .permissions import IsStaffUser
from .ratelimit import is_rate_limited

User = get_user_model()
logger = logging.getLogger(__name__)


def _stripe():
    key = (getattr(settings, 'STRIPE_SECRET_KEY', '') or '').strip()
    if not key:
        return None
    stripe.api_key = key
    return stripe


def _ts_to_dt(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if timezone.is_aware(value) else timezone.make_aware(value, dt_timezone.utc)
    try:
        return datetime.fromtimestamp(int(value), tz=dt_timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


def _apply_subscription_object(profile: SubscriberProfile, subscription) -> None:
    status_value = getattr(subscription, 'status', None) or (
        subscription.get('status') if isinstance(subscription, dict) else None
    )
    if status_value in dict(SubscriberProfile.Status.choices):
        profile.status = status_value
    elif status_value == 'unpaid':
        profile.status = SubscriberProfile.Status.PAST_DUE
    elif status_value:
        profile.status = SubscriberProfile.Status.INACTIVE

    sub_id = getattr(subscription, 'id', None) or (
        subscription.get('id') if isinstance(subscription, dict) else None
    )
    if sub_id:
        profile.stripe_subscription_id = sub_id

    period_end = getattr(subscription, 'current_period_end', None)
    if period_end is None and isinstance(subscription, dict):
        period_end = subscription.get('current_period_end')
    profile.current_period_end = _ts_to_dt(period_end)
    if status_value == SubscriberProfile.Status.TRIALING or status_value == 'trialing':
        profile.trial_used = True
        send_pass_activated_email(profile.user, until_date=profile.current_period_end)
    if status_value == SubscriberProfile.Status.ACTIVE or status_value == 'active':
        profile.trial_used = True
        send_pass_activated_email(profile.user, until_date=profile.current_period_end)
    profile.save()


class BillingCheckoutView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        api = _stripe()
        price_id = (getattr(settings, 'STRIPE_PRICE_ID', '') or '').strip()
        frontend = (getattr(settings, 'FRONTEND_URL', '') or 'http://localhost:5173').rstrip('/')
        if api is None or not price_id:
            return Response(
                {
                    'detail': 'Stripe is not configured. Ask an admin to activate Offline Pass, or set STRIPE_SECRET_KEY and STRIPE_PRICE_ID.',
                    'code': 'stripe_not_configured',
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        if is_rate_limited(f'checkout:{request.user.pk}', limit=10, window_seconds=600):
            return Response(
                {'detail': 'Too many checkout attempts. Try again later.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        profile = ensure_subscriber_profile(request.user)
        if profile.is_banned:
            return Response(
                {'detail': 'This account is blocked from Offline Pass.', 'code': 'banned'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not profile.email_verified:
            return Response(
                {
                    'detail': 'Verify your email before starting Offline Pass.',
                    'code': 'email_unverified',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        device_id = (
            request.data.get('device_id')
            or request.headers.get('X-Device-Id')
            or ''
        ).strip()
        offer_trial = not profile.trial_used and profile.status != SubscriberProfile.Status.ACTIVE
        if offer_trial:
            blocked, code = device_trial_blocked(device_id, user=request.user)
            if blocked:
                detail = {
                    'device_required': 'Device id required to start the free trial.',
                    'device_used': 'Free trial was already used on this device. Subscribe to continue.',
                }.get(code, 'Cannot start trial on this device.')
                return Response(
                    {'detail': detail, 'code': code},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        try:
            if not profile.stripe_customer_id:
                customer = api.Customer.create(
                    email=request.user.email or request.user.username,
                    metadata={'user_id': str(request.user.pk)},
                )
                profile.stripe_customer_id = customer.id
                profile.save(update_fields=['stripe_customer_id', 'updated_at'])

            session_kwargs = {
                'mode': 'subscription',
                'customer': profile.stripe_customer_id,
                'line_items': [{'price': price_id, 'quantity': 1}],
                'success_url': f'{frontend}/?billing=success&session_id={{CHECKOUT_SESSION_ID}}',
                'cancel_url': f'{frontend}/?billing=cancel',
                'client_reference_id': str(request.user.pk),
                'metadata': {
                    'user_id': str(request.user.pk),
                    'device_id': device_id[:128],
                    'offer_trial': '1' if offer_trial else '0',
                },
                'integration_identifier': 'platino_offline_pass_a1b2c3d4',
            }
            if offer_trial:
                # Card required up front; charge starts after the configured trial.
                session_kwargs['payment_method_collection'] = 'always'
                session_kwargs['subscription_data'] = {
                    'trial_period_days': trial_days(),
                    'trial_settings': {
                        'end_behavior': {'missing_payment_method': 'cancel'},
                    },
                    'metadata': {
                        'user_id': str(request.user.pk),
                        'device_id': device_id[:128],
                    },
                }

            session = api.checkout.Session.create(**session_kwargs)
        except Exception as exc:
            logger.exception('Stripe checkout failed')
            return Response(
                {'detail': f'Could not start checkout: {exc}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        return Response(
            {
                'ok': True,
                'url': session.url,
                'session_id': session.id,
                'trial_offered': offer_trial,
            }
        )


class BillingStartTrialView(APIView):
    """Local no-card trial fallback (only when Stripe is not configured / ALLOW_LOCAL_TRIAL)."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if is_rate_limited(f'trial:{request.user.pk}', limit=5, window_seconds=600):
            return Response(
                {'detail': 'Too many trial attempts. Try again later.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        if stripe_configured() and not getattr(settings, 'ALLOW_LOCAL_TRIAL', ''):
            # Prefer Stripe card-required trial.
            pass

        device_id = (
            request.data.get('device_id')
            or request.headers.get('X-Device-Id')
            or ''
        ).strip()
        ok, _profile, code = start_free_trial(request.user, device_id=device_id)
        if not ok:
            detail = {
                'already_active': 'Offline Pass is already active on this account.',
                'trial_active': 'Your free trial is already running.',
                'trial_used': 'Free trial was already used on this account. Subscribe to continue.',
                'email_unverified': 'Verify your email before starting the free trial.',
                'device_required': 'Device id required to start the free trial.',
                'device_used': 'Free trial was already used on this device.',
                'banned': 'This account is blocked from Offline Pass.',
                'use_stripe_trial': (
                    f'Start your free trial via Get Pass (card required, '
                    f'no charge for {trial_days()} days).'
                ),
            }.get(code, 'Could not start free trial.')
            return Response(
                {
                    'detail': detail,
                    'code': code,
                    'subscription': subscription_payload(request.user),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                'ok': True,
                'message': 'Free trial started.',
                'offline_access': user_has_offline_access(request.user),
                'subscription': subscription_payload(request.user),
            }
        )


class BillingPortalView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        api = _stripe()
        frontend = (getattr(settings, 'FRONTEND_URL', '') or 'http://localhost:5173').rstrip('/')
        profile = ensure_subscriber_profile(request.user)
        if api is None or not profile.stripe_customer_id:
            return Response(
                {'detail': 'No Stripe customer on this account yet.', 'code': 'no_customer'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            session = api.billing_portal.Session.create(
                customer=profile.stripe_customer_id,
                return_url=f'{frontend}/',
            )
        except Exception as exc:
            logger.exception('Stripe portal failed')
            return Response(
                {'detail': f'Could not open billing portal: {exc}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response({'ok': True, 'url': session.url})


@method_decorator(csrf_exempt, name='dispatch')
class BillingWebhookView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        api = _stripe()
        secret = (getattr(settings, 'STRIPE_WEBHOOK_SECRET', '') or '').strip()
        if api is None:
            return Response({'detail': 'Stripe not configured.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        payload = request.body
        sig = request.META.get('HTTP_STRIPE_SIGNATURE', '')
        try:
            if secret:
                event = api.Webhook.construct_event(payload, sig, secret)
            else:
                # Local/dev without webhook secret — parse JSON only (not for production).
                import json

                event = api.Event.construct_from(json.loads(payload), api.api_key)
        except Exception as exc:
            logger.warning('Stripe webhook reject: %s', exc)
            return Response({'detail': 'Invalid webhook.'}, status=status.HTTP_400_BAD_REQUEST)

        event_type = event['type'] if isinstance(event, dict) else event.type
        data_object = event['data']['object'] if isinstance(event, dict) else event.data.object

        try:
            self._handle_event(event_type, data_object, api)
        except Exception:
            logger.exception('Stripe webhook handler error for %s', event_type)
            return Response({'detail': 'Handler error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response({'ok': True})

    def _profile_for_customer(self, customer_id):
        if not customer_id:
            return None
        return SubscriberProfile.objects.filter(stripe_customer_id=customer_id).select_related('user').first()

    def _profile_for_user_id(self, user_id):
        if not user_id:
            return None
        try:
            user = User.objects.get(pk=int(user_id))
        except (User.DoesNotExist, TypeError, ValueError):
            return None
        return ensure_subscriber_profile(user)

    def _handle_event(self, event_type, obj, api):
        if event_type == 'checkout.session.completed':
            customer_id = obj.get('customer') if isinstance(obj, dict) else obj.customer
            user_id = None
            if isinstance(obj, dict):
                user_id = (obj.get('client_reference_id') or (obj.get('metadata') or {}).get('user_id'))
            else:
                user_id = obj.client_reference_id or (getattr(obj, 'metadata', None) or {}).get('user_id')
            profile = self._profile_for_customer(customer_id) or self._profile_for_user_id(user_id)
            if not profile:
                return
            if customer_id and profile.stripe_customer_id != customer_id:
                profile.stripe_customer_id = customer_id
            meta = obj.get('metadata') if isinstance(obj, dict) else getattr(obj, 'metadata', None) or {}
            device_id = (meta.get('device_id') if isinstance(meta, dict) else '') or ''
            if device_id:
                bind_trial_device(profile.user, device_id)
            sub_id = obj.get('subscription') if isinstance(obj, dict) else obj.subscription
            if sub_id:
                profile.stripe_subscription_id = sub_id
                try:
                    subscription = api.Subscription.retrieve(sub_id)
                    _apply_subscription_object(profile, subscription)
                    return
                except Exception:
                    logger.exception('Could not retrieve subscription %s', sub_id)
                    profile.status = SubscriberProfile.Status.ACTIVE
                    profile.trial_used = True
            profile.trial_used = True
            profile.save()
            return

        if event_type in (
            'customer.subscription.updated',
            'customer.subscription.deleted',
            'customer.subscription.created',
        ):
            customer_id = obj.get('customer') if isinstance(obj, dict) else obj.customer
            profile = self._profile_for_customer(customer_id)
            if not profile:
                sub_id = obj.get('id') if isinstance(obj, dict) else obj.id
                profile = SubscriberProfile.objects.filter(stripe_subscription_id=sub_id).first()
            if not profile:
                return
            if event_type == 'customer.subscription.deleted':
                profile.status = SubscriberProfile.Status.CANCELED
                profile.current_period_end = _ts_to_dt(
                    obj.get('current_period_end') if isinstance(obj, dict) else obj.current_period_end
                )
                profile.save()
            else:
                _apply_subscription_object(profile, obj)
            return

        if event_type in ('invoice.paid', 'invoice.payment_failed'):
            customer_id = obj.get('customer') if isinstance(obj, dict) else obj.customer
            profile = self._profile_for_customer(customer_id)
            if not profile:
                return
            sub_id = obj.get('subscription') if isinstance(obj, dict) else obj.subscription
            if sub_id:
                try:
                    subscription = api.Subscription.retrieve(sub_id)
                    _apply_subscription_object(profile, subscription)
                    return
                except Exception:
                    logger.exception('invoice event: could not retrieve sub %s', sub_id)
            if event_type == 'invoice.payment_failed':
                profile.status = SubscriberProfile.Status.PAST_DUE
                profile.save(update_fields=['status', 'updated_at'])


class BillingAdminActivateView(APIView):
    """Staff: grant offline access until a date (manual payment fallback)."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsStaffUser]

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        user_id = request.data.get('user_id')
        until_raw = request.data.get('until') or request.data.get('manual_override_until')

        if user_id:
            user = get_object_or_404(User, pk=user_id)
        elif email:
            user = User.objects.filter(email__iexact=email).first() or User.objects.filter(username__iexact=email).first()
            if not user:
                return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
        else:
            return Response(
                {'detail': 'Provide email or user_id.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not until_raw:
            return Response(
                {'detail': 'Provide until (ISO datetime or YYYY-MM-DD).'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        until = parse_datetime(str(until_raw))
        if until is None and len(str(until_raw)) == 10:
            until = parse_datetime(f'{until_raw}T23:59:59')
        if until is None:
            return Response({'detail': 'Invalid until datetime.'}, status=status.HTTP_400_BAD_REQUEST)
        if timezone.is_naive(until):
            until = timezone.make_aware(until, timezone.get_current_timezone())

        profile = ensure_subscriber_profile(user)
        profile.manual_override_until = until
        if profile.status == SubscriberProfile.Status.INACTIVE:
            profile.status = SubscriberProfile.Status.ACTIVE
        profile.save()
        send_pass_activated_email(user, until_date=until)

        return Response(
            {
                'ok': True,
                'username': user.username,
                'email': user.email,
                'offline_access': user_has_offline_access(user),
                'subscription': subscription_payload(user),
            }
        )


class BillingAdminModerateView(APIView):
    """Staff kill switch: ban / unban / revoke trial / mark email verified."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsStaffUser]

    def post(self, request):
        action = (request.data.get('action') or '').strip().lower()
        email = (request.data.get('email') or '').strip().lower()
        user_id = request.data.get('user_id')

        if user_id:
            user = get_object_or_404(User, pk=user_id)
        elif email:
            user = (
                User.objects.filter(email__iexact=email).first()
                or User.objects.filter(username__iexact=email).first()
            )
            if not user:
                return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
        else:
            return Response(
                {'detail': 'Provide email or user_id.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        profile = ensure_subscriber_profile(user)
        if action == 'ban':
            profile.is_banned = True
            profile.status = SubscriberProfile.Status.INACTIVE
            profile.manual_override_until = None
            profile.save()
        elif action == 'unban':
            profile.is_banned = False
            profile.save(update_fields=['is_banned', 'updated_at'])
        elif action == 'revoke_trial':
            profile.status = SubscriberProfile.Status.INACTIVE
            profile.current_period_end = timezone.now()
            profile.trial_used = True
            profile.manual_override_until = None
            profile.save()
        elif action == 'verify_email':
            profile.email_verified = True
            profile.save(update_fields=['email_verified', 'updated_at'])
        elif action == 'grant_trial':
            ok, _profile, code = grant_manual_trial(user)
            if not ok:
                return Response(
                    {'detail': 'Could not grant trial.', 'code': code},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif action == 'send_activation_email':
            res = send_pass_activated_email(user, background=False)
            if not res.get('sent'):
                return Response(
                    {'detail': res.get('detail', 'Could not send activation email.')},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif action == 'send_expiring_email':
            res = send_pass_expiring_email(user, background=False)
            if not res.get('sent'):
                return Response(
                    {'detail': res.get('detail', 'Could not send expiring email.')},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif action == 'check_expiring':
            count = check_and_send_expiring_emails()
            return Response({'ok': True, 'queued_count': count, 'detail': f'{count} expiring emails queued.'})
        else:
            return Response(
                {
                    'detail': 'action must be one of: ban, unban, revoke_trial, verify_email, grant_trial, send_activation_email, send_expiring_email, check_expiring',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                'ok': True,
                'action': action,
                'email': user.email or user.username,
                'offline_access': user_has_offline_access(user),
                'subscription': subscription_payload(user),
            }
        )


class BillingSubscribersListView(APIView):
    """Staff: list subscriber profiles for Control Room."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsStaffUser]

    def get(self, request):
        qs = (
            SubscriberProfile.objects.select_related('user')
            .order_by('-updated_at')[:200]
        )
        results = []
        for profile in qs:
            user = profile.user
            results.append(
                {
                    'id': profile.id,
                    'user_id': user.id,
                    'username': user.username,
                    'email': user.email or user.username,
                    'status': profile.status,
                    'current_period_end': (
                        profile.current_period_end.isoformat() if profile.current_period_end else None
                    ),
                    'manual_override_until': (
                        profile.manual_override_until.isoformat()
                        if profile.manual_override_until
                        else None
                    ),
                    'offline_access': user_has_offline_access(user),
                    'trial_used': bool(profile.trial_used),
                    'email_verified': bool(profile.email_verified),
                    'is_banned': bool(profile.is_banned),
                    'stripe_customer_id': profile.stripe_customer_id or '',
                }
            )
        return Response({'count': len(results), 'results': results})


class ReferralCampaignAdminView(APIView):
    """Staff: List, create, configure, and delete Referral & Promo Campaigns."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsStaffUser]

    def get(self, request):
        campaigns = ReferralCampaign.objects.all()
        results = []
        for c in campaigns:
            valid, reason = c.check_validity()
            results.append({
                'id': c.id,
                'code': c.code,
                'title': c.title,
                'bonus_days': c.bonus_days,
                'max_redeems': c.max_redeems,
                'redeem_count': c.redeem_count,
                'valid_until': c.valid_until.isoformat() if c.valid_until else None,
                'is_active': c.is_active,
                'is_valid': valid,
                'status_reason': reason,
                'created_at': c.created_at.isoformat(),
            })
        return Response({'count': len(results), 'results': results})

    def post(self, request):
        code = (request.data.get('code') or '').strip().upper()
        if not code:
            return Response({'detail': 'Campaign code is required.'}, status=status.HTTP_400_BAD_REQUEST)

        title = (request.data.get('title') or '').strip()
        try:
            bonus_days = max(1, int(request.data.get('bonus_days') or 3))
        except (TypeError, ValueError):
            bonus_days = 3

        try:
            max_redeems = max(0, int(request.data.get('max_redeems') or 0))
        except (TypeError, ValueError):
            max_redeems = 0

        valid_until_raw = request.data.get('valid_until')
        valid_until = parse_datetime(valid_until_raw) if valid_until_raw else None

        is_active = bool(request.data.get('is_active', True))

        campaign, created = ReferralCampaign.objects.get_or_create(code=code)
        campaign.title = title
        campaign.bonus_days = bonus_days
        campaign.max_redeems = max_redeems
        campaign.valid_until = valid_until
        campaign.is_active = is_active
        campaign.save()

        return Response({
            'ok': True,
            'message': 'Referral campaign created.' if created else 'Referral campaign updated.',
            'campaign': {
                'id': campaign.id,
                'code': campaign.code,
                'title': campaign.title,
                'bonus_days': campaign.bonus_days,
                'max_redeems': campaign.max_redeems,
                'redeem_count': campaign.redeem_count,
                'valid_until': campaign.valid_until.isoformat() if campaign.valid_until else None,
                'is_active': campaign.is_active,
            }
        })

    def delete(self, request):
        campaign_id = request.data.get('id') or request.query_params.get('id')
        if not campaign_id:
            return Response({'detail': 'Campaign ID required.'}, status=status.HTTP_400_BAD_REQUEST)

        campaign = get_object_or_404(ReferralCampaign, pk=campaign_id)
        campaign.delete()
        return Response({'ok': True, 'message': 'Referral campaign deleted.'})
