import re
import time

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from agri.database_routing import read_database_mode, select_database
from agri.database_sync import sync_models


def safe_error_message(exc):
    message = str(exc)
    for database in settings.DATABASES.values():
        for key in ("PASSWORD", "USER", "HOST", "NAME"):
            value = database.get(key)
            if value:
                message = message.replace(str(value), "<redacted>")
    message = re.sub(
        r"(postgres(?:ql)?://)[^@\s]+@",
        r"\1<redacted>@",
        message,
        flags=re.IGNORECASE,
    )
    return message[:300]


class Command(BaseCommand):
    help = "Keep the Supabase backup synchronized with the local primary."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true")
        parser.add_argument("--interval", type=int, default=15)

    def handle(self, *args, **options):
        if "supabase" not in settings.DATABASES:
            raise CommandError("Set SUPABASE_DB_URL before running the database backup worker.")
        if options["interval"] < 5:
            raise CommandError("The backup interval must be at least five seconds.")

        while True:
            try:
                active_database = select_database()
                if active_database != "default":
                    self.stdout.write(
                        "Local is not active; skipping backup to avoid overwriting failover data."
                    )
                else:
                    result = sync_models(
                        source="default",
                        target="supabase",
                        source_wins=True,
                        prune=True,
                        abort_if_mode=lambda: read_database_mode() == "supabase",
                    )
                    self.stdout.write(
                        f"Supabase backup synchronized; {result['records_changed']} records changed."
                    )
            except Exception as exc:
                self.stderr.write(
                    self.style.ERROR(
                        f"Supabase backup synchronization failed: "
                        f"{type(exc).__name__}: {safe_error_message(exc)}"
                    )
                )
                if options["once"]:
                    raise CommandError("The one-time Supabase backup synchronization failed.") from exc

            if options["once"]:
                return
            time.sleep(options["interval"])
