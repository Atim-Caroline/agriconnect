import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.db import DatabaseError
from django.http import JsonResponse
from django.test import RequestFactory, TestCase, override_settings
from rest_framework.test import APIClient

from .database_routing import (
    DatabaseFailoverMiddleware,
    get_active_database,
)
from .database_sync import sync_models
from .models import (
    BuyerRequest,
    Crop,
    Delivery,
    District,
    Order,
    ProduceListing,
    User,
)


class HealthEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_reports_database_ready(self):
        response = self.client.get("/api/v1/health/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "ok")
        self.assertEqual(response.data["database"], "ok")

    def test_reports_database_unavailable(self):
        with patch("agri.views.connections") as connections:
            connections.__getitem__.return_value.cursor.side_effect = DatabaseError(
                "database unavailable"
            )
            response = self.client.get("/api/v1/health/")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data["status"], "unavailable")
        self.assertEqual(response.data["database"], "unavailable")


class DatabaseFailoverTests(TestCase):
    def setUp(self):
        self.request = RequestFactory().get("/api/v1/health/")

    def test_local_failure_switches_requests_to_supabase_and_persists_mode(self):
        with TemporaryDirectory() as directory:
            mode_file = Path(directory) / "database-mode"
            with override_settings(AGRI_DATABASE_MODE_FILE=mode_file):
                with patch(
                    "agri.database_routing.database_is_healthy",
                    side_effect=lambda alias: alias == "supabase",
                ):
                    middleware = DatabaseFailoverMiddleware(
                        lambda request: JsonResponse({"database": get_active_database()})
                    )
                    response = middleware(self.request)

            self.assertEqual(json.loads(response.content), {"database": "supabase"})
            self.assertEqual(mode_file.read_text(encoding="utf-8"), "supabase")

    def test_supabase_failover_stays_active_until_operator_switches_back(self):
        with TemporaryDirectory() as directory:
            mode_file = Path(directory) / "database-mode"
            mode_file.write_text("supabase", encoding="utf-8")
            with override_settings(AGRI_DATABASE_MODE_FILE=mode_file):
                with patch(
                    "agri.database_routing.database_is_healthy",
                    side_effect=lambda alias: alias == "supabase",
                ) as health_check:
                    middleware = DatabaseFailoverMiddleware(
                        lambda request: JsonResponse({"database": get_active_database()})
                    )
                    response = middleware(self.request)

            self.assertEqual(json.loads(response.content), {"database": "supabase"})
            health_check.assert_called_once_with("supabase")

    def test_returns_service_unavailable_when_neither_database_works(self):
        with TemporaryDirectory() as directory:
            with override_settings(
                AGRI_DATABASE_MODE_FILE=Path(directory) / "database-mode"
            ):
                with patch("agri.database_routing.database_is_healthy", return_value=False):
                    middleware = DatabaseFailoverMiddleware(lambda request: self.fail())
                    response = middleware(self.request)

            self.assertEqual(response.status_code, 503)


class DatabaseSyncTests(TestCase):
    databases = {"default", "supabase"}

    def test_sync_copies_foreign_keys_and_is_repeatable(self):
        district = District.objects.using("default").create(name="Sync Lira", region="North")
        crop = Crop.objects.using("default").create(
            name="Sync Maize",
            category="cereal",
            default_unit="kg",
        )
        farmer = User(
            phone="+256700009991",
            full_name="Sync Farmer",
            role="farmer",
            district=district,
            is_verified=True,
        )
        farmer.set_password("test-password")
        farmer.save(using="default")
        listing = ProduceListing.objects.using("default").create(
            farmer=farmer,
            crop=crop,
            title="Sync listing",
            quantity_available="5.00",
            price_per_unit="1000.00",
            district=district,
        )

        sync_models("default", "supabase", source_wins=True)
        replicated = ProduceListing.objects.using("supabase").get(title="Sync listing")
        self.assertEqual(replicated.farmer.phone, farmer.phone)
        self.assertEqual(replicated.crop.name, crop.name)
        self.assertEqual(replicated.district.name, district.name)

        repeated = sync_models("default", "supabase", source_wins=True)
        self.assertEqual(
            ProduceListing.objects.using("supabase").filter(title="Sync listing").count(),
            1,
        )
        self.assertEqual(repeated["conflicts"], [])

    def test_merge_keeps_target_on_conflict_and_reports_it(self):
        District.objects.using("default").create(name="Shared District", region="Local")
        District.objects.using("supabase").create(name="Shared District", region="Cloud")

        result = sync_models("supabase", "default", source_wins=False)

        district = District.objects.using("default").get(name="Shared District")
        self.assertEqual(district.region, "Local")
        self.assertIn("region", result["conflicts"][0]["conflicting_fields"])

        sync_models("default", "supabase", source_wins=True)
        self.assertEqual(
            District.objects.using("supabase").get(name="Shared District").region,
            "Local",
        )


class ProjectRoleAndCoordinationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.district = District.objects.create(name="Lira", region="Northern")
        self.destination = District.objects.create(name="Kampala", region="Central")
        self.crop = Crop.objects.create(name="Maize", category="cereal", default_unit="kg")
        self.farmer = self.create_user("farmer", "farmer")
        self.buyer = self.create_user("buyer", "buyer")
        self.other_buyer = self.create_user("other-buyer", "buyer")
        self.transporter = self.create_user("transporter", "transporter")
        self.other_transporter = self.create_user("other-transporter", "transporter")
        self.admin = self.create_user("admin", "admin")
        self.listing = ProduceListing.objects.create(
            farmer=self.farmer,
            crop=self.crop,
            title="Test maize",
            quantity_available="5.00",
            price_per_unit="1000.00",
            district=self.district,
            status="active",
        )

    def create_user(self, name, role):
        return User.objects.create_user(
            phone=f"07000000{len(name):02d}{role[0]}",
            password="test-password",
            full_name=name,
            role=role,
            is_verified=True,
            district=self.district,
        )

    def authenticate_as(self, user):
        self.client.force_authenticate(user=user)

    def test_public_registration_cannot_create_an_admin(self):
        response = self.client.post(
            "/api/v1/auth/register/",
            {
                "full_name": "Untrusted Admin",
                "phone": "0700000098",
                "password": "a-secure-test-password",
                "role": "admin",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(User.objects.filter(phone="0700000098").exists())

    def test_role_boundaries_are_enforced_by_api(self):
        self.authenticate_as(self.buyer)
        self.assertEqual(self.client.get("/api/v1/admin/reports/summary/").status_code, 403)
        self.assertEqual(
            self.client.post(
                "/api/v1/marketplace/produce/",
                {
                    "crop": self.crop.pk,
                    "title": "Unauthorized listing",
                    "quantity_available": 10,
                    "price_per_unit": 1000,
                    "district": self.district.pk,
                },
                format="json",
            ).status_code,
            403,
        )

        self.authenticate_as(self.transporter)
        self.assertEqual(
            self.client.post(
                "/api/v1/orders/requests/",
                {"listing": str(self.listing.pk), "quantity": 1},
                format="json",
            ).status_code,
            403,
        )

        self.authenticate_as(self.admin)
        self.assertEqual(self.client.get("/api/v1/admin/reports/summary/").status_code, 200)

    def test_competing_purchase_acceptance_cannot_oversell_stock(self):
        requests = [
            BuyerRequest.objects.create(
                buyer=buyer,
                farmer=self.farmer,
                listing=self.listing,
                quantity="4.00",
            )
            for buyer in (self.buyer, self.other_buyer)
        ]
        self.authenticate_as(self.farmer)

        first = self.client.patch(
            f"/api/v1/orders/requests/{requests[0].pk}/",
            {"action": "accept"},
            format="json",
        )
        competing = self.client.patch(
            f"/api/v1/orders/requests/{requests[1].pk}/",
            {"action": "accept"},
            format="json",
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(competing.status_code, 409)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.quantity_available, 1)
        self.assertEqual(Order.objects.filter(listing=self.listing).count(), 1)
        self.assertEqual(BuyerRequest.objects.get(pk=requests[1].pk).status, "cancelled")

    def test_only_one_transporter_can_claim_a_shared_delivery(self):
        order = Order.objects.create(
            order_number="AC-TEST-0001",
            buyer=self.buyer,
            seller=self.farmer,
            listing=self.listing,
            item_title=self.listing.title,
            quantity="1.00",
            unit="kg",
            unit_price="1000.00",
            total_amount="1000.00",
        )
        delivery = Delivery.objects.create(
            order=order,
            pickup_district=self.district,
            dropoff_district=self.destination,
        )

        self.authenticate_as(self.transporter)
        first = self.client.post(f"/api/v1/transport/jobs/{delivery.pk}/accept/")
        self.authenticate_as(self.other_transporter)
        competing = self.client.post(f"/api/v1/transport/jobs/{delivery.pk}/accept/")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(competing.status_code, 409)
        delivery.refresh_from_db()
        self.assertEqual(delivery.transporter_id, self.transporter.pk)
        self.assertEqual(Delivery.objects.filter(pk=delivery.pk, status="accepted").count(), 1)
