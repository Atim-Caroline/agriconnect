"""Outbox worker: delivers pending events, retrying with growing delays (30s, 1m, 5m, 15m, 1h) then marks them dead."""
import json, time, urllib.request
from datetime import timedelta
from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone
from agri.models import SyncEvent
DELAYS = [30, 60, 300, 900, 3600]

def deliver(e):
    for peer in settings.SYNC_PEERS:
        body = json.dumps({"id": str(e.id), "event_type": e.event_type, "payload": e.payload}).encode()
        req = urllib.request.Request(peer.rstrip("/") + "/api/v1/sync/events/", body,
            {"Content-Type": "application/json", "X-Service-Token": settings.SYNC_TOKEN})
        urllib.request.urlopen(req, timeout=5).read()

class Command(BaseCommand):
    def add_arguments(self, p): p.add_argument("--once", action="store_true")
    def handle(self, *a, **o):
        while True:
            for e in SyncEvent.objects.filter(status__in=["pending", "failed"], next_attempt_at__lte=timezone.now())[:50]:
                try:
                    deliver(e); e.status = "acknowledged"
                except Exception as ex:
                    e.attempts += 1; e.last_error = str(ex)[:300]
                    e.status = "dead" if e.attempts >= len(DELAYS) else "failed"
                    e.next_attempt_at = timezone.now() + timedelta(seconds=DELAYS[min(e.attempts - 1, len(DELAYS) - 1)])
                e.save()
            if o["once"]: break
            time.sleep(5)
