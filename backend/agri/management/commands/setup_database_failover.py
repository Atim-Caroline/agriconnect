import json
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from agri.database_routing import database_is_healthy, write_database_mode
from agri.database_sync import sync_models


class Command(BaseCommand):
    help = (
        "Push the local SQLite database to Supabase as the initial backup. "
        "Local is the sole source of truth; any existing Supabase data is replaced."
    )

    def add_arguments(self, parser):
        parser.add_argument("--report", help="Path for the backup report.")

    def handle(self, *args, **options):
        if "supabase" not in settings.DATABASES:
            raise CommandError("Set SUPABASE_DB_URL before configuring database failover.")
        if not database_is_healthy("default"):
            raise CommandError("Local database is unavailable.")
        if not database_is_healthy("supabase"):
            raise CommandError(
                "Cannot reach Supabase. Check SUPABASE_DB_URL and that "
                "migrations have been applied with: python manage.py migrate --database=supabase"
            )

        # Local is authoritative: push local → Supabase and prune any
        # cloud-only records so Supabase is an exact copy of local.
        backup = sync_models(
            source="default",
            target="supabase",
            source_wins=True,
            prune=True,
        )
        report = {"initial_backup": backup}
        report_path = Path(
            options["report"]
            or settings.BASE_DIR
            / "backup-reports"
            / ("initial-backup-" + datetime.now().strftime("%Y%m%d-%H%M%S") + ".json")
        )
        try:
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
        except OSError as exc:
            raise CommandError(f"Could not write backup report: {exc}") from exc

        write_database_mode("local")
        self.stdout.write(
            self.style.SUCCESS(
                f"Local database is primary; Supabase backup initialized "
                f"({backup['records_changed']} records written). "
                f"Report at {report_path}."
            )
        )
