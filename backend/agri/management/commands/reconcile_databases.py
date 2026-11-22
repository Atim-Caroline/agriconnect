import json
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from agri.database_sync import sync_models


ALIASES = {"local": "default", "supabase": "supabase"}


class Command(BaseCommand):
    help = "Merge records between the local and Supabase databases."

    def add_arguments(self, parser):
        parser.add_argument("--source", choices=ALIASES, required=True)
        parser.add_argument("--target", choices=ALIASES, required=True)
        parser.add_argument(
            "--conflicts",
            choices=("source", "target"),
            default="target",
            help="Which database's fields win when unique records conflict.",
        )
        parser.add_argument(
            "--prune",
            action="store_true",
            help="Remove target records absent from the source snapshot.",
        )
        parser.add_argument("--report", help="Path for a conflict report.")

    def handle(self, *args, **options):
        source = ALIASES[options["source"]]
        target = ALIASES[options["target"]]
        result = sync_models(
            source=source,
            target=target,
            source_wins=options["conflicts"] == "source",
            prune=options["prune"],
        )
        report_path = Path(
            options["report"]
            or settings.BASE_DIR
            / "backup-reports"
            / ("reconcile-" + datetime.now().strftime("%Y%m%d-%H%M%S") + ".json")
        )
        try:
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(
                json.dumps(result, indent=2, sort_keys=True),
                encoding="utf-8",
            )
        except OSError as exc:
            raise CommandError(f"Could not write conflict report: {exc}") from exc

        self.stdout.write(
            self.style.SUCCESS(
                f"Synced {result['records_changed']} records from "
                f"{result['source']} to {result['target']}; "
                f"{len(result['conflicts'])} conflicts reported at {report_path}."
            )
        )
