import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from agri.models import *
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

client = APIClient()

print("--- Testing AgriConnect Normal System Flow ---")

# 1. Test Admin Superuser Status
admin_user = User.objects.get(phone="+256700000009")
assert admin_user.is_staff and admin_user.is_superuser, "Admin must have superuser and staff permissions for Django Admin"
token = str(RefreshToken.for_user(admin_user).access_token)
client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
print("[OK] Admin Superuser Verified: is_staff=True, is_superuser=True")

# 2. Test Available Transporters endpoint (for buyer dropdown)
res_transporters = client.get("/api/v1/transport/transporters/")
assert res_transporters.status_code == 200
assert len(res_transporters.data) >= 1
chosen_transporter = res_transporters.data[0]
print(f"[OK] Available Transporters list fetched: {len(res_transporters.data)} verified haulers (e.g. {chosen_transporter['name']})")

# 3. Test Farmer Posting Produce WITH PICTURE
farmer_user = User.objects.get(phone="+256700000001")
f_token = str(RefreshToken.for_user(farmer_user).access_token)
client.credentials(HTTP_AUTHORIZATION=f"Bearer {f_token}")

crop = Crop.objects.get(name="Tomatoes")
dist = District.objects.get(name="Kabale")
sample_pic = "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=600&auto=format&fit=crop"

res_create = client.post("/api/v1/marketplace/produce/", {
    "crop": crop.id,
    "title": "Fresh Greenhouse Tomatoes",
    "quantity_available": 150,
    "unit": "crate",
    "price_per_unit": 42000,
    "district": dist.id,
    "quality_grade": "A",
    "image_url": sample_pic,
    "description": "Sorted A-Grade Kiboko tomatoes with photo"
}, format="json")
assert res_create.status_code == 201, f"Listing failed: {res_create.data}"
assert res_create.data["image_url"] == sample_pic
print("[OK] Farmer Posted Produce WITH PICTURE:", res_create.data["title"])
new_listing_id = res_create.data["id"]

# 4. Test Buyer Purchasing & CHOOSING TRANSPORTER
buyer_user = User.objects.get(phone="+256700000003")
b_token = str(RefreshToken.for_user(buyer_user).access_token)
client.credentials(HTTP_AUTHORIZATION=f"Bearer {b_token}")

res_req = client.post("/api/v1/orders/requests/", {
    "listing": new_listing_id,
    "quantity": 25,
    "delivery_needed": True,
    "delivery_district": District.objects.get(name="Kampala").id,
    "preferred_transporter": chosen_transporter["id"],
    "message": "Please pack in wooden crates, deliver to Kampala."
}, format="json")
assert res_req.status_code == 201, f"Buyer request failed: {res_req.data}"
assert res_req.data["preferred_transporter_id"] == str(chosen_transporter["id"])
print(f"[OK] Buyer Purchased Produce and CHOSE TRANSPORTER: {res_req.data['preferred_transporter_name']}")
req_id = res_req.data["id"]

# 5. Farmer Accepts -> Delivery assigned directly to chosen transporter
client.credentials(HTTP_AUTHORIZATION=f"Bearer {f_token}")
res_acc = client.patch(f"/api/v1/orders/requests/{req_id}/", {"action": "accept"}, format="json")
assert res_acc.status_code == 200

order = Order.objects.get(request_id=req_id)
delivery = Delivery.objects.get(order=order)
assert str(delivery.transporter_id) == str(chosen_transporter["id"])
assert delivery.status == "accepted"
print(f"[OK] Farmer Accepted Request -> Order {order.order_number} confirmed, Delivery automatically assigned to {chosen_transporter['name']}")

# 6. Transporter cannot place orders
t_user = User.objects.get(pk=chosen_transporter["id"])
t_token = str(RefreshToken.for_user(t_user).access_token)
client.credentials(HTTP_AUTHORIZATION=f"Bearer {t_token}")

res_bad = client.post("/api/v1/orders/requests/", {"listing": new_listing_id, "quantity": 10}, format="json")
assert res_bad.status_code == 403
print("[OK] Transporter CANNOT place orders (403 Forbidden verified)")

# 7. Transporter checks assigned deliveries & progresses trip
res_my_del = client.get("/api/v1/transport/deliveries/")
assert res_my_del.status_code == 200
assert any(d["id"] == str(delivery.id) for d in res_my_del.data)
print("[OK] Transporter Sees Assigned Delivery in My Deliveries")

res_step = client.patch(f"/api/v1/transport/deliveries/{delivery.id}/status/", {"status": "picked_up"}, format="json")
assert res_step.status_code == 200
print("[OK] Transporter Progressed Delivery to 'picked_up'")

# 8. Admin preview everything & approve pending user
client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
res_admin_orders = client.get("/api/v1/admin/all_orders/")
assert res_admin_orders.status_code == 200
assert any(o["id"] == str(order.id) for o in res_admin_orders.data)
print(f"[OK] Admin Previews All Nationwide Orders ({len(res_admin_orders.data)} total orders)")

pending_user = User.objects.filter(is_verified=False).first()
if pending_user:
    res_verify = client.post(f"/api/v1/users/{pending_user.id}/verify/", {"approve": True}, format="json")
    assert res_verify.status_code == 200
    print(f"[OK] Admin Approved Verification for {pending_user.role} {pending_user.full_name}")

print("\nALL SYSTEM TESTS PASSED SUCCESSFULLY!")
