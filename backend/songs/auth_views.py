from django.contrib.auth import authenticate, get_user_model, login, logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .disposable_emails import is_disposable_email
from .email_verify import loads_email_verify_token, mark_email_verified, send_verification_email
from .entitlements import (
    apply_referral,
    ensure_subscriber_profile,
    start_free_trial,
    subscription_payload,
    user_has_offline_access,
)
from .google_auth import verify_google_id_token
from .password_reset import send_password_reset_email, validate_password_reset_token
from .permissions import IsStaffUser
from .ratelimit import client_ip, is_rate_limited

User = get_user_model()


def _auth_payload(user):
    profile = ensure_subscriber_profile(user) if user.is_authenticated else None
    return {
        'authenticated': True,
        'username': user.username,
        'email': user.email or '',
        'is_staff': bool(user.is_staff or user.is_superuser),
        'is_superuser': bool(user.is_superuser),
        'offline_access': user_has_offline_access(user),
        'subscription': subscription_payload(user),
        'email_verified': bool(profile.email_verified) if profile else False,
    }


class CsrfView(APIView):
    """Issue CSRF cookie for login forms."""

    authentication_classes = []
    permission_classes = [AllowAny]

    @method_decorator(ensure_csrf_cookie)
    def get(self, request):
        return Response({'csrfToken': get_token(request)})


class AdminLoginView(APIView):
    """Staff/superuser login used by the frontend Admin Login page."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    def post(self, request):
        if is_rate_limited(
            f'login:{client_ip(request)}',
            limit=12,
            window_seconds=600,
        ):
            return Response(
                {'detail': 'Too many login attempts. Try again later.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        username = (request.data.get('username') or '').strip()
        password = request.data.get('password') or ''

        if not username or not password:
            return Response(
                {'detail': 'Username and password are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = authenticate(request, username=username, password=password)
        if user is None:
            return Response(
                {'detail': 'Invalid username or password.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if not user.is_active or not (user.is_staff or user.is_superuser):
            return Response(
                {'detail': 'This account does not have admin access.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        login(request, user)
        return Response(
            {
                'ok': True,
                'username': user.username,
                'is_superuser': user.is_superuser,
                'message': 'Login successful.',
                **_auth_payload(user),
            }
        )


class AdminLogoutView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    def post(self, request):
        logout(request)
        return Response({'ok': True})


class AdminMeView(APIView):
    """Session identity for admin gate and subscriber account UI."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    def get(self, request):
        user = request.user
        if not user.is_authenticated:
            return Response({'authenticated': False})
        return Response(_auth_payload(user))


class AdminChangePasswordView(APIView):
    """Allow signed-in staff to change their own password."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsStaffUser]

    def post(self, request):
        current_password = request.data.get('current_password') or ''
        new_password = request.data.get('new_password') or ''
        confirm_password = request.data.get('confirm_password') or ''

        if not current_password or not new_password or not confirm_password:
            return Response(
                {'detail': 'Current password, new password, and confirmation are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if new_password != confirm_password:
            return Response(
                {'detail': 'New password and confirmation do not match.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = request.user
        if not user.check_password(current_password):
            return Response(
                {'detail': 'Current password is incorrect.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if current_password == new_password:
            return Response(
                {'detail': 'New password must be different from the current password.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            validate_password(new_password, user=user)
        except ValidationError as exc:
            return Response(
                {'detail': exc.messages[0] if exc.messages else 'Password is not strong enough.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(new_password)
        user.save(update_fields=['password'])
        update_session_auth_hash(request, user)

        return Response(
            {
                'ok': True,
                'message': 'Password updated successfully.',
            }
        )


class SubscriberRegisterView(APIView):
    """Public signup for Offline Pass accounts (no auto-trial — verify email first)."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    def post(self, request):
        ip = client_ip(request)
        if is_rate_limited(f'register:{ip}', limit=3, window_seconds=600):
            return Response(
                {'detail': 'Too many sign-up attempts. Try again later.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        if is_rate_limited(f'register-day:{ip}', limit=5, window_seconds=86400):
            return Response(
                {'detail': 'Daily sign-up limit reached for this network.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        email = (request.data.get('email') or '').strip().lower()
        password = request.data.get('password') or ''
        confirm = request.data.get('confirm_password') or request.data.get('password_confirm') or ''

        if not email or '@' not in email:
            return Response({'detail': 'A valid email is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if is_disposable_email(email):
            return Response(
                {'detail': 'Disposable email addresses are not allowed. Use a real email.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not password:
            return Response({'detail': 'Password is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if confirm and password != confirm:
            return Response(
                {'detail': 'Password and confirmation do not match.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if User.objects.filter(username__iexact=email).exists() or User.objects.filter(email__iexact=email).exists():
            return Response(
                {'detail': 'An account with this email already exists.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            validate_password(password)
        except ValidationError as exc:
            return Response(
                {'detail': exc.messages[0] if exc.messages else 'Password is not strong enough.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = User.objects.create_user(username=email, email=email, password=password)
        ensure_subscriber_profile(user)
        device_id = (
            request.data.get('device_id')
            or request.headers.get('X-Device-Id')
            or ''
        ).strip()
        start_free_trial(user, device_id=device_id)

        referral_code = (
            request.data.get('referral_code')
            or request.data.get('ref')
            or request.query_params.get('ref')
            or ''
        ).strip()
        referral_msg = ''
        if referral_code:
            ok_ref, ref_msg = apply_referral(user, referral_code)
            if ok_ref:
                referral_msg = ref_msg

        # Optional verify email (not required for local trial by default).
        mail = send_verification_email(user)
        login(request, user)
        msg = 'Account created. Free trial started — save the offline catalog.'
        if referral_msg:
            msg = f'{msg} {referral_msg}'

        return Response(
            {
                'ok': True,
                'message': msg,
                'verification': mail,
                **_auth_payload(user),
            },
            status=status.HTTP_201_CREATED,
        )


class SubscriberLoginView(APIView):
    """Non-staff subscriber login (email + password). Staff admin login stays separate."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    def post(self, request):
        if is_rate_limited(
            f'sub-login:{client_ip(request)}',
            limit=12,
            window_seconds=600,
        ):
            return Response(
                {'detail': 'Too many login attempts. Try again later.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        email = (request.data.get('email') or request.data.get('username') or '').strip().lower()
        password = request.data.get('password') or ''
        if not email or not password:
            return Response(
                {'detail': 'Email and password are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = authenticate(request, username=email, password=password)
        if user is None:
            match = User.objects.filter(email__iexact=email).first()
            if match:
                user = authenticate(request, username=match.username, password=password)

        if user is None or not user.is_active:
            return Response(
                {'detail': 'Invalid email or password.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        ensure_subscriber_profile(user)
        login(request, user)
        return Response({'ok': True, 'message': 'Login successful.', **_auth_payload(user)})


class VerifyEmailView(APIView):
    """Confirm email via signed token from the verification link."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    def post(self, request):
        token = (request.data.get('token') or '').strip()
        if not token:
            return Response({'detail': 'Missing token.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            data = loads_email_verify_token(token)
        except Exception:
            return Response(
                {'detail': 'Invalid or expired verification link.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            user = User.objects.get(pk=int(data['uid']))
        except (User.DoesNotExist, KeyError, TypeError, ValueError):
            return Response({'detail': 'Invalid verification link.'}, status=status.HTTP_400_BAD_REQUEST)

        if not mark_email_verified(user, data.get('email') or ''):
            return Response(
                {'detail': 'Could not verify this email.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # A verification link identifies its owner. Always switch the session
        # to that owner so the response, browser session, and entitlement
        # checks cannot disagree when somebody else was already signed in.
        login(request, user)
        return Response(
            {
                'ok': True,
                'message': 'Email verified. You can start your Offline Pass trial.',
                **_auth_payload(user),
            }
        )


class ResendVerificationEmailView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if is_rate_limited(f'verify-resend:{request.user.pk}', limit=3, window_seconds=600):
            return Response(
                {'detail': 'Too many resend attempts. Try again later.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        profile = ensure_subscriber_profile(request.user)
        if profile.email_verified:
            return Response({'ok': True, 'message': 'Email already verified.', **_auth_payload(request.user)})
        mail = send_verification_email(request.user)
        return Response({'ok': True, 'verification': mail, **_auth_payload(request.user)})


class ApplyReferralView(APIView):
    """Apply a friend's referral code to extend trial by +3 days for both users."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        code = (
            request.data.get('referral_code')
            or request.data.get('ref')
            or ''
        ).strip()
        if not code:
            return Response(
                {'detail': 'Referral code is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ok, msg = apply_referral(request.user, code)
        if not ok:
            return Response({'detail': msg}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            'ok': True,
            'message': msg,
            **_auth_payload(request.user),
        })


class ForgotPasswordRequestView(APIView):
    """
    Request a password reset link.
    Sends reset email if the user exists and returns a generic success response
    to avoid account enumeration.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    def post(self, request):
        ip = client_ip(request)
        if is_rate_limited(f'forgot-pw:{ip}', limit=5, window_seconds=600):
            return Response(
                {'detail': 'Too many password reset requests. Please try again later.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        email = (request.data.get('email') or request.data.get('username') or '').strip().lower()
        if not email:
            return Response(
                {'detail': 'Email address is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = User.objects.filter(email__iexact=email).first()
        if not user:
            user = User.objects.filter(username__iexact=email).first()

        mail_result = None
        if user and user.is_active:
            mail_result = send_password_reset_email(user)

        resp_payload: dict[str, object] = {
            'ok': True,
            'message': 'If an account with this email exists, a password reset link has been sent.',
        }
        if mail_result and ('reset_url' in mail_result or 'token' in mail_result):
            resp_payload['reset_info'] = mail_result

        return Response(resp_payload, status=status.HTTP_200_OK)


class ResetPasswordConfirmView(APIView):
    """
    Reset password using signed token.
    Validates token and updates user password, then automatically logs the user in.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    def post(self, request):
        ip = client_ip(request)
        if is_rate_limited(f'reset-confirm:{ip}', limit=10, window_seconds=600):
            return Response(
                {'detail': 'Too many attempts. Please try again later.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        token = (request.data.get('token') or '').strip()
        new_password = request.data.get('new_password') or request.data.get('password') or ''
        confirm_password = (
            request.data.get('confirm_password')
            or request.data.get('password_confirm')
            or ''
        )

        if not token:
            return Response(
                {'detail': 'Reset token is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not new_password:
            return Response(
                {'detail': 'New password is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if confirm_password and new_password != confirm_password:
            return Response(
                {'detail': 'New password and confirmation do not match.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user, err_msg = validate_password_reset_token(token)
        if user is None:
            return Response(
                {'detail': err_msg or 'Invalid or expired password reset link.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            validate_password(new_password, user=user)
        except ValidationError as exc:
            return Response(
                {'detail': exc.messages[0] if exc.messages else 'Password is not strong enough.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(new_password)
        user.save(update_fields=['password'])
        update_session_auth_hash(request, user)
        ensure_subscriber_profile(user)
        login(request, user)

        return Response(
            {
                'ok': True,
                'message': 'Password has been reset successfully.',
                **_auth_payload(user),
            },
            status=status.HTTP_200_OK,
        )


class GoogleAuthView(APIView):
    """
    Sign in or Sign up using Google Identity Services (ID token credential).
    Pre-verifies email, starts a 3-day free trial for new users, applies referrals,
    and returns session auth payload.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    def post(self, request):
        ip = client_ip(request)
        if is_rate_limited(f'google-auth:{ip}', limit=20, window_seconds=600):
            return Response(
                {'detail': 'Too many Google sign-in attempts. Please try again later.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        credential = (
            request.data.get('credential')
            or request.data.get('id_token')
            or request.data.get('token')
            or ''
        ).strip()
        if not credential:
            return Response(
                {'detail': 'Google credential token is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        google_data, err_msg = verify_google_id_token(credential)
        if google_data is None:
            return Response(
                {'detail': err_msg or 'Google sign-in failed.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        email = google_data['email']
        user = User.objects.filter(email__iexact=email).first()
        if not user:
            user = User.objects.filter(username__iexact=email).first()

        is_new_user = False
        referral_msg = ''
        if user is None:
            user = User.objects.create_user(username=email, email=email)
            user.set_unusable_password()
            user.save()
            is_new_user = True

            profile = ensure_subscriber_profile(user)
            profile.email_verified = True
            profile.save(update_fields=['email_verified', 'updated_at'])

            device_id = (
                request.data.get('device_id')
                or request.headers.get('X-Device-Id')
                or ''
            ).strip()
            start_free_trial(user, device_id=device_id)

            referral_code = (
                request.data.get('referral_code')
                or request.data.get('ref')
                or request.query_params.get('ref')
                or ''
            ).strip()
            if referral_code:
                ok_ref, ref_msg = apply_referral(user, referral_code)
                if ok_ref:
                    referral_msg = ref_msg
        else:
            if not user.is_active:
                return Response(
                    {'detail': 'This account has been deactivated.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
            profile = ensure_subscriber_profile(user)
            if not profile.email_verified:
                profile.email_verified = True
                profile.save(update_fields=['email_verified', 'updated_at'])

        login(request, user)

        msg = (
            'Welcome! Free trial started with your Google account.'
            if is_new_user
            else 'Signed in with Google.'
        )
        if referral_msg:
            msg = f'{msg} {referral_msg}'

        return Response(
            {
                'ok': True,
                'message': msg,
                'is_new_user': is_new_user,
                **_auth_payload(user),
            },
            status=status.HTTP_200_OK if not is_new_user else status.HTTP_201_CREATED,
        )


