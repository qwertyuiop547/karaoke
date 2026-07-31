from django.contrib.auth import authenticate, get_user_model, login, logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .entitlements import (
    ensure_subscriber_profile,
    subscription_payload,
    user_has_offline_access,
)
from .permissions import IsStaffUser
from .ratelimit import client_ip, is_rate_limited

User = get_user_model()


def _auth_payload(user):
    return {
        'authenticated': True,
        'username': user.username,
        'email': user.email or '',
        'is_staff': bool(user.is_staff or user.is_superuser),
        'is_superuser': bool(user.is_superuser),
        'offline_access': user_has_offline_access(user),
        'subscription': subscription_payload(user),
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
    """Public signup for Offline Pass accounts."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    def post(self, request):
        if is_rate_limited(
            f'register:{client_ip(request)}',
            limit=8,
            window_seconds=600,
        ):
            return Response(
                {'detail': 'Too many sign-up attempts. Try again later.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        email = (request.data.get('email') or '').strip().lower()
        password = request.data.get('password') or ''
        confirm = request.data.get('confirm_password') or request.data.get('password_confirm') or ''

        if not email or '@' not in email:
            return Response({'detail': 'A valid email is required.'}, status=status.HTTP_400_BAD_REQUEST)
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
        login(request, user)
        return Response({'ok': True, 'message': 'Account created.', **_auth_payload(user)}, status=status.HTTP_201_CREATED)


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
            # Allow login if they registered with email field but different username casing
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
