import os
from datetime import timedelta
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit

# Load .env file if present (python-dotenv)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-change-me-to-a-longer-secure-key-32chars")
DEBUG = os.environ.get("DEBUG", "1") == "1"
ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "agri",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]

ROOT_URLCONF = "config.urls"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "APP_DIRS": True,
    "OPTIONS": {
        "context_processors": [
            "django.template.context_processors.request",
            "django.contrib.auth.context_processors.auth",
            "django.contrib.messages.context_processors.messages",
        ]
    }
}]

# -------------------------------------------------------
# DATABASE CONFIGURATION
#
# Local development defaults to SQLite.
# Set SUPABASE_DB_URL to use one shared Supabase PostgreSQL database for all
# Django nodes. SQLite is retained as a separate alias, not an automatic
# failover or synchronized backup.
# -------------------------------------------------------
SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL", "").strip()

if SUPABASE_DB_URL:
    try:
        database_url = urlsplit(SUPABASE_DB_URL)
    except ValueError as exc:
        raise RuntimeError(
            "SUPABASE_DB_URL must be a valid PostgreSQL connection URI from "
            "the Supabase dashboard, not the Supabase project API URL."
        ) from exc

    if database_url.scheme not in ("postgres", "postgresql") or not database_url.hostname:
        raise RuntimeError(
            "SUPABASE_DB_URL must be a PostgreSQL connection URI from "
            "Supabase Dashboard -> Connect. The project API URL (https://<project>.supabase.co) "
            "cannot be used as a database connection."
        )

    try:
        import dj_database_url  # pip install dj-database-url psycopg2-binary
        query = [
            (key, value)
            for key, value in parse_qsl(database_url.query, keep_blank_values=True)
            if key.lower() != "pgbouncer"
        ]
        connection_url = database_url._replace(query=urlencode(query)).geturl()
        database_config = dj_database_url.parse(
            connection_url,
            conn_max_age=0,
            conn_health_checks=True,
        )
        database_config.setdefault("OPTIONS", {}).setdefault("sslmode", "require")
        DATABASES = {
            "default": database_config,
            # Retained only for explicit management commands; Django does not
            # automatically fail over between this alias and Supabase.
            "local": {
                "ENGINE": "django.db.backends.sqlite3",
                "NAME": BASE_DIR / "db.sqlite3",
            },
        }
    except ImportError:
        raise RuntimeError(
            "SUPABASE_DB_URL is set but 'dj-database-url' is not installed. "
            "Run: pip install dj-database-url psycopg2-binary"
        )
else:
    # Local SQLite (default for development — no config needed)
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

AUTH_USER_MODEL = "agri.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"}
]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication"
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated"
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle"
    ],
    "DEFAULT_THROTTLE_RATES": {"anon": "2000/hour"},
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
}

CORS_ALLOW_ALL_ORIGINS = True
STATIC_URL = "static/"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
USE_TZ = True
TIME_ZONE = "Africa/Kampala"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
SYNC_PEERS = [p for p in os.environ.get("SYNC_PEERS", "").split(",") if p]
SYNC_TOKEN = os.environ.get("SYNC_TOKEN", "dev-service-token")
AGRI_NODE_ID = os.environ.get("AGRI_NODE_ID", "")
