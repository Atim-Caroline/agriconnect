import json
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from agri.database_routing import database_is_healthy, write_database_mode
from agri.database_sync import sync_models


class Command(BaseCommand):
    help = "Merge Supabase outage writes into local, refresh the backup, and switch back."

    def add_arguments(self, parser):
        parser.add_argument("--report", help="Path for the reconciliation report.")

    def handle(self, *args, **options):
        if "supabase" not in settings.DATABASES:
            raise CommandError("Set SUPABASE_DB_URL before reconciling database failover.")
        if not database_is_healthy("default") or not database_is_healthy("supabase"):
            raise CommandError("Both databases must be available before failing back to local.")

        cloud_import = sync_models(
            source="supabase",
            target="default",
            source_wins=True,
        )
        backup_refresh = sync_models(
            source="default",
            target="supabase",
            source_wins=True,
            prune=True,
        )
        report = {
            "cloud_import": cloud_import,
            "backup_refresh": backup_refresh,
        }
        report_path = Path(
            options["report"]
            or settings.BASE_DIR
            / "backup-reports"
            / ("failback-" + datetime.now().strftime("%Y%m%d-%H%M%S") + ".json")
        )
        try:
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
        except OSError as exc:
            raise CommandError(f"Could not write reconciliation report: {exc}") from exc

        write_database_mode("local")
        self.stdout.write(
            self.style.SUCCESS(
                f"Supabase changes merged; local database is active again. "
                f"Conflicts are reported at {report_path}."
            )
        )
