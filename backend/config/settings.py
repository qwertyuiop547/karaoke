from pathlib import Path
import os
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent.parent / '.env')

BASE_DIR = Path(__file__).resolve().parent.parent

DEBUG = os.getenv('DJANGO_DEBUG', 'true').lower() == 'true'
SECRET_KEY = os.getenv('DJANGO_SECRET_KEY', 'django-insecure-dev-only-change-me')
if not DEBUG and SECRET_KEY.startswith('django-insecure'):
    raise RuntimeError('Set a strong DJANGO_SECRET_KEY when DJANGO_DEBUG=false.')

ALLOWED_HOSTS = [h.strip() for h in os.getenv('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',') if h.strip()]
_public_host = (
    os.getenv('RENDER_EXTERNAL_HOSTNAME')
    or os.getenv('RAILWAY_PUBLIC_DOMAIN')
    or ''
).strip()
if _public_host and _public_host not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(_public_host)

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'django_filters',
    'songs',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

# Local default: SQLite. Production: DATABASE_URL or USE_SQLITE=false + Postgres.
USE_SQLITE = os.getenv('USE_SQLITE', 'true').lower() == 'true'
CONN_MAX_AGE = int(os.getenv('CONN_MAX_AGE', '60' if not USE_SQLITE else '0'))
DATABASE_URL = (os.getenv('DATABASE_URL') or '').strip()

if DATABASE_URL:
    import dj_database_url

    DATABASES = {
        'default': dj_database_url.config(
            default=DATABASE_URL,
            conn_max_age=CONN_MAX_AGE,
            ssl_require=os.getenv('DATABASE_SSL_REQUIRE', 'true').lower() == 'true',
        )
    }
elif USE_SQLITE:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
            'OPTIONS': {
                'timeout': 30,
            },
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.getenv('POSTGRES_DB', 'karaoke'),
            'USER': os.getenv('POSTGRES_USER', 'karaoke'),
            'PASSWORD': os.getenv('POSTGRES_PASSWORD', 'karaoke'),
            'HOST': os.getenv('POSTGRES_HOST', 'localhost'),
            'PORT': os.getenv('POSTGRES_PORT', '5433'),
            'CONN_MAX_AGE': CONN_MAX_AGE,
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Manila'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
FRONTEND_DIST = BASE_DIR / 'frontend_dist'
# Vite build is served from site root via WhiteNoise (index.html + /assets/*).
WHITENOISE_ROOT = FRONTEND_DIST if FRONTEND_DIST.is_dir() else None
STORAGES = {
    'default': {
        'BACKEND': 'django.core.files.storage.FileSystemStorage',
    },
    'staticfiles': {
        'BACKEND': 'whitenoise.storage.CompressedStaticFilesStorage',
    },
}
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        'CORS_ALLOWED_ORIGINS',
        'http://localhost:5173,http://127.0.0.1:5173',
    ).split(',')
    if origin.strip()
]
CORS_ALLOW_CREDENTIALS = True

CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        'CSRF_TRUSTED_ORIGINS',
        'http://localhost:5173,http://127.0.0.1:5173',
    ).split(',')
    if origin.strip()
]
if _public_host:
    _public_origin = f'https://{_public_host}'
    if _public_origin not in CSRF_TRUSTED_ORIGINS:
        CSRF_TRUSTED_ORIGINS.append(_public_origin)
    if _public_origin not in CORS_ALLOWED_ORIGINS:
        CORS_ALLOWED_ORIGINS.append(_public_origin)

# Frontend admin login redirects here after success
ADMIN_FRONTEND_REDIRECT = os.getenv('ADMIN_URL', 'http://127.0.0.1:8000/admin/')

REST_FRAMEWORK = {
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
}

REDIS_URL = (os.getenv('REDIS_URL') or '').strip()
if REDIS_URL:
    CACHES = {
        'default': {
            'BACKEND': 'django_redis.cache.RedisCache',
            'LOCATION': REDIS_URL,
            'OPTIONS': {
                'CLIENT_CLASS': 'django_redis.client.DefaultClient',
            },
            'KEY_PREFIX': 'karaoke',
        }
    }
    # Keep sessions out of Postgres under load
    SESSION_ENGINE = 'django.contrib.sessions.backends.cache'
else:
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
            'LOCATION': 'karaoke-cache',
        }
    }
    if USE_SQLITE:
        # Avoid SQLite locks on every request (presence/ping used to 500 here)
        SESSION_ENGINE = 'django.contrib.sessions.backends.signed_cookies'

# Presence / list cache knobs
PRESENCE_TTL_SECONDS = int(os.getenv('PRESENCE_TTL_SECONDS', '90'))
SONG_LIST_CACHE_TTL = int(os.getenv('SONG_LIST_CACHE_TTL', '20'))

# Stripe Offline Pass (subscription)
_default_frontend = (
    f'https://{_public_host}' if _public_host else 'http://localhost:5173'
)
FRONTEND_URL = os.getenv('FRONTEND_URL', _default_frontend).rstrip('/')
STRIPE_SECRET_KEY = os.getenv('STRIPE_SECRET_KEY', '').strip()
STRIPE_PUBLISHABLE_KEY = os.getenv('STRIPE_PUBLISHABLE_KEY', '').strip()
STRIPE_WEBHOOK_SECRET = os.getenv('STRIPE_WEBHOOK_SECRET', '').strip()
STRIPE_PRICE_ID = os.getenv('STRIPE_PRICE_ID', '').strip()
OFFLINE_PASS_LABEL = os.getenv('OFFLINE_PASS_LABEL', 'Offline Pass · ₱149/mo')

# SQLite: WAL + busy timeout reduces "database is locked" under concurrent reads/writes
if USE_SQLITE:
    from django.db.backends.signals import connection_created

    def _sqlite_pragma(sender, connection, **kwargs):
        if connection.vendor != 'sqlite':
            return
        cursor = connection.cursor()
        cursor.execute('PRAGMA journal_mode=WAL;')
        cursor.execute('PRAGMA synchronous=NORMAL;')
        cursor.execute('PRAGMA busy_timeout=30000;')

    connection_created.connect(_sqlite_pragma)

# Harden cookies / TLS when not in DEBUG
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_SSL_REDIRECT = os.getenv('SECURE_SSL_REDIRECT', 'false').lower() == 'true'
    SECURE_HSTS_SECONDS = int(os.getenv('SECURE_HSTS_SECONDS', '31536000'))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = 'DENY'
