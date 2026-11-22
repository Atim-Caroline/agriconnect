import logging
import os
import tempfile
from contextvars import ContextVar
from pathlib import Path

from django.conf import settings
from django.db import DatabaseError, connections
from django.http import JsonResponse

logger = logging.getLogger(__name__)
active_database = ContextVar("agri_active_database", default="default")


def get_active_database():
    return active_database.get()


def get_database_mode_file():
    return Path(
        getattr(
            settings,
            "AGRI_DATABASE_MODE_FILE",
            settings.BASE_DIR / ".database-mode",
        )
    )


def read_database_mode():
    mode_file = get_database_mode_file()
    if not mode_file.exists():
        return "local"

    mode = mode_file.read_text(encoding="utf-8").strip()
    if mode not in ("local", "supabase"):
        raise RuntimeError(f"Invalid database mode in {mode_file}.")
    return mode


def write_database_mode(mode):
    if mode not in ("local", "supabase"):
        raise ValueError("Database mode must be 'local' or 'supabase'.")

    mode_file = get_database_mode_file()
    mode_file.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=mode_file.parent,
        prefix=mode_file.name + ".",
        delete=False,
    ) as temporary_file:
        temporary_file.write(mode)
        temporary_path = Path(temporary_file.name)
    os.replace(temporary_path, mode_file)


def database_is_healthy(alias):
    if alias not in settings.DATABASES:
        return False

    database_config = settings.DATABASES[alias]
    if database_config["ENGINE"] == "django.db.backends.sqlite3":
        database_name = str(database_config["NAME"])
        memory_database = (
            database_name == ":memory:"
            or "mode=memory" in database_name
            or database_config.get("TEST", {}).get("NAME") == ":memory:"
        )
        database_path = Path(database_name)
        if not memory_database and not database_path.is_file():
            return False

    connection = connections[alias]
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
            cursor.execute('SELECT 1 FROM "users" LIMIT 0')
        return True
    except DatabaseError:
        logger.warning("Database readiness check failed for alias '%s'.", alias)
        connection.close()
        return False


def select_database():
    mode = read_database_mode()
    if mode == "supabase":
        return "supabase" if database_is_healthy("supabase") else None

    if database_is_healthy("default"):
        return "default"
    if database_is_healthy("supabase"):
        write_database_mode("supabase")
        logger.error("Local database unavailable; switched to Supabase failover.")
        return "supabase"
    return None


class AgriDatabaseRouter:
    routed_apps = {"agri", "auth", "contenttypes", "sessions", "admin"}

    def db_for_read(self, model, **hints):
        if model._meta.app_label in self.routed_apps:
            return get_active_database()
        return None

    def db_for_write(self, model, **hints):
        if model._meta.app_label in self.routed_apps:
            return get_active_database()
        return None

    def allow_relation(self, obj1, obj2, **hints):
        if (
            obj1._meta.app_label in self.routed_apps
            and obj2._meta.app_label in self.routed_apps
        ):
            return True
        return None


class DatabaseFailoverMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not request.path.startswith(("/api/", "/admin/")):
            return self.get_response(request)

        alias = select_database()
        if alias is None:
            return JsonResponse(
                {"detail": "Local and Supabase databases are unavailable."},
                status=503,
            )

        token = active_database.set(alias)
        try:
            return self.get_response(request)
        finally:
            active_database.reset(token)
