import logging
import uuid
from functools import wraps
from django.conf import settings
from django.db import DatabaseError, connections, transaction
from django.db.models import F, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from .models import *

logger = logging.getLogger(__name__)


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    try:
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except DatabaseError:
        logger.warning("Database readiness check failed.")
        return Response(
            {"status": "unavailable", "database": "unavailable"},
            status=503,
        )

    return Response({
        "status": "ok",
        "database": "ok",
        "node": getattr(settings, "AGRI_NODE_ID", "") or None,
    })


def role_required(*roles):
    def deco(fn):
        @wraps(fn)
        def w(request, *a, **k):
            if not request.user.is_authenticated:
                return err("Log in first.", 401)
            if request.user.role not in roles and request.user.role != "admin":
                return Response({"detail": f"Not allowed for role '{request.user.role}'."}, status=403)
            return fn(request, *a, **k)
        return w
    return deco

def err(msg, code=400):
    return Response({"detail": msg}, status=code)

def emit(t, payload):
    return SyncEvent.objects.create(event_type=t, payload=payload)

def notify(user, title, body=""):
    return Notification.objects.create(user=user, title=title, body=body)

# ---------- serializers ----------
class UserS(serializers.ModelSerializer):
    district_name = serializers.CharField(source="district.name", read_only=True, default=None)
    class Meta:
        model = User
        fields = [
            "id", "full_name", "phone", "email", "role", "district",
            "district_name", "verification_doc", "is_verified",
            "preferred_language", "created_at"
        ]
        read_only_fields = ["role", "phone", "created_at"]

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        instance = super().update(instance, validated_data)
        if password:
            instance.set_password(password)
            instance.save()
        return instance

class UserSWithPassword(UserS):
    password = serializers.CharField(write_only=True, min_length=8, required=False)
    class Meta(UserS.Meta):
        fields = UserS.Meta.fields + ["password"]

class RegisterS(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)
    verification_doc = serializers.CharField(required=False, allow_blank=True, default="")
    class Meta:
        model = User
        fields = ["full_name", "phone", "email", "password", "role", "district", "verification_doc", "preferred_language"]
        extra_kwargs = {"email": {"required": False, "allow_null": True}}

    def validate_role(self, v):
        if v not in ("farmer", "buyer", "transporter"):
            raise serializers.ValidationError("Choose farmer, buyer or transporter.")
        return v

    def create(self, d):
        d["email"] = d.get("email") or None
        doc = d.pop("verification_doc", "")
        role = d.get("role", "buyer")
        # Farmers and Transporters start unverified awaiting admin approval.
        is_verified = role == "buyer"
        return User.objects.create_user(
            d.pop("phone"),
            d.pop("password"),
            verification_doc=doc,
            is_verified=is_verified,
            **d
        )

class ListingS(serializers.ModelSerializer):
    farmer_name = serializers.CharField(source="farmer.full_name", read_only=True)
    farmer_phone = serializers.CharField(source="farmer.phone", read_only=True)
    farmer_verified = serializers.BooleanField(source="farmer.is_verified", read_only=True)
    crop_name = serializers.CharField(source="crop.name", read_only=True)
    district_name = serializers.CharField(source="district.name", read_only=True)
    region = serializers.CharField(source="district.region", read_only=True)
    image = serializers.ImageField(required=False, allow_null=True)
    image_url = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = ProduceListing
        fields = "__all__"
        read_only_fields = ["farmer", "status", "version", "is_flagged", "created_at", "updated_at"]

# ---------- auth & accounts ----------
@api_view(["POST"])
@permission_classes([AllowAny])
def register(request):
    s = RegisterS(data=request.data)
    s.is_valid(raise_exception=True)
    u = s.save()
    t = RefreshToken.for_user(u)
    emit("user.registered", {
        "user_id": str(u.id),
        "name": u.full_name,
        "role": u.role,
        "is_verified": u.is_verified,
        "doc": u.verification_doc
    })
    # If unverified, alert admins
    if not u.is_verified:
        admins = User.objects.filter(role="admin")
        for a in admins:
            notify(a, "Verification Needed", f"New {u.role}: {u.full_name} ({u.phone}) submitted credentials.")
    return Response({"user": UserS(u).data, "access": str(t.access_token), "refresh": str(t)}, 201)

@api_view(["GET", "PATCH"])
def me(request):
    if request.method == "PATCH":
        s = UserSWithPassword(request.user, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
    return Response(UserS(request.user).data)

@api_view(["GET"])
@permission_classes([AllowAny])
def districts(request):
    return Response(list(District.objects.values("id", "name", "region")))

@api_view(["GET"])
@permission_classes([AllowAny])
def crops(request):
    return Response(list(Crop.objects.values("id", "name", "category", "default_unit")))

# ---------- marketplace ----------
@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def produce(request):
    u = request.user
    if request.method == "POST":
        if not u.is_authenticated:
            return err("Log in first.", 401)
        if u.role != "farmer":
            return err("Only farmers can list produce.", 403)
        s = ListingS(data=request.data)
        s.is_valid(raise_exception=True)
        obj = s.save(farmer=u, status="active" if u.is_verified else "pending_review")
        if "image" in request.FILES:
            obj.image = request.FILES["image"]
            obj.save()
        elif request.data.get("image_url"):
            obj.image_url = request.data["image_url"]
            obj.save()
        emit("listing.created", {"id": str(obj.id), "title": obj.title, "farmer": u.full_name, "version": obj.version})
        return Response(ListingS(obj).data, 201)

    p = request.query_params
    if p.get("mine") and u.is_authenticated:
        qs = ProduceListing.objects.filter(farmer=u).exclude(status="removed")
    else:
        qs = ProduceListing.objects.filter(status="active", quantity_available__gt=0)
    qs = qs.select_related("farmer", "crop", "district")
    if p.get("q"):
        qs = qs.filter(Q(title__icontains=p["q"]) | Q(crop__name__icontains=p["q"]))
    if p.get("district"):
        qs = qs.filter(district__name__iexact=p["district"])
    if p.get("region"):
        qs = qs.filter(district__region__iexact=p["region"])
    if p.get("crop"):
        qs = qs.filter(crop_id=p["crop"])
    if p.get("max_price"):
        qs = qs.filter(price_per_unit__lte=p["max_price"])
    if p.get("min_qty"):
        qs = qs.filter(quantity_available__gte=p["min_qty"])
    if p.get("sort") in ("price_per_unit", "-price_per_unit", "-created_at"):
        qs = qs.order_by(p["sort"])
    pg = PageNumberPagination()
    pg.page_size = 20
    pg.page_size_query_param = "page_size"
    pg.max_page_size = 100
    return pg.get_paginated_response(ListingS(pg.paginate_queryset(qs, request), many=True).data)

@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([AllowAny])
def produce_detail(request, pk):
    obj = get_object_or_404(ProduceListing.objects.select_related("farmer", "crop", "district"), pk=pk)
    u = request.user
    if request.method == "GET":
        if obj.status not in ("active", "sold_out") and obj.farmer_id != getattr(u, "id", None) and getattr(u, "role", "") != "admin":
            return err("Not found.", 404)
        return Response(ListingS(obj).data)
    if not u.is_authenticated or (obj.farmer_id != u.id and u.role != "admin"):
        return err("You can only change your own listings.", 403)
    if request.method == "DELETE":
        obj.status = "removed"
        obj.save()
        emit("listing.removed", {"id": str(obj.id), "version": obj.version})
        return Response(status=204)
    s = ListingS(obj, data=request.data, partial=True)
    s.is_valid(raise_exception=True)
    obj = s.save()
    if "image" in request.FILES:
        obj.image = request.FILES["image"]
        obj.save()
    emit("listing.updated", {"id": str(obj.id), "version": obj.version})
    return Response(ListingS(obj).data)

# ---------- requests & orders ----------
def req_d(r):
    return dict(
        id=str(r.id),
        listing=str(r.listing_id),
        title=r.listing.title,
        unit=r.listing.unit,
        crop_name=r.listing.crop.name if r.listing and r.listing.crop else "",
        district_name=r.listing.district.name if r.listing and r.listing.district else "",
        buyer=r.buyer.full_name,
        buyer_id=str(r.buyer_id),
        farmer=r.farmer.full_name,
        farmer_id=str(r.farmer_id),
        quantity=float(r.quantity),
        offered_price=float(r.offered_price) if r.offered_price else None,
        message=r.message,
        delivery_needed=r.delivery_needed,
        delivery_district=r.delivery_district.name if r.delivery_district else None,
        preferred_transporter_id=str(r.preferred_transporter_id) if r.preferred_transporter_id else None,
        preferred_transporter_name=r.preferred_transporter.full_name if r.preferred_transporter else None,
        status=r.status,
        created_at=r.created_at
    )

def order_d(o, u):
    d = Delivery.objects.filter(order=o).first()
    other = o.seller if o.buyer_id == u.id else o.buyer
    pickup_name = d.pickup_district.name if d else (o.listing.district.name if o.listing and o.listing.district else "")
    dropoff_name = d.dropoff_district.name if d else ""
    return dict(
        id=str(o.id),
        order_number=o.order_number,
        item_title=o.item_title,
        crop_name=o.listing.crop.name if o.listing and o.listing.crop else "",
        quantity=float(o.quantity),
        unit=o.unit,
        unit_price=float(o.unit_price),
        total_amount=float(o.total_amount),
        status=o.status,
        payment_status=o.payment_status,
        payment_method=o.payment_method,
        delivery_required=o.delivery_required,
        side="buyer" if o.buyer_id == u.id else ("seller" if o.seller_id == u.id else "admin"),
        buyer_id=str(o.buyer_id),
        buyer_name=o.buyer.full_name,
        buyer_phone=o.buyer.phone,
        seller_id=str(o.seller_id),
        seller_name=o.seller.full_name,
        seller_phone=o.seller.phone,
        other_name=other.full_name if other else "",
        other_phone=other.phone if other else "",
        pickup_district=pickup_name,
        dropoff_district=dropoff_name,
        delivery_status=d.status if d else None,
        delivery_id=str(d.id) if d else None,
        transporter_name=d.transporter.full_name if d and d.transporter else None,
        transporter_phone=d.transporter.phone if d and d.transporter else None,
        created_at=o.created_at
    )

@api_view(["GET", "POST"])
def requests_(request):
    u = request.user
    if request.method == "GET":
        qs = BuyerRequest.objects.filter(Q(buyer=u) | Q(farmer=u)).select_related("listing", "buyer", "farmer", "delivery_district", "preferred_transporter", "listing__crop", "listing__district")
        return Response([req_d(r) for r in qs])
    if u.role != "buyer":
        return err("Only buyers can place purchase requests.", 403)
    l = get_object_or_404(ProduceListing, pk=request.data.get("listing"), status="active")
    try:
        qty = float(request.data.get("quantity"))
    except (TypeError, ValueError):
        return err("Enter a valid quantity.")
    if qty <= 0 or qty > float(l.quantity_available):
        return err(f"Quantity must be between 1 and {l.quantity_available} {l.unit}.")

    transporter_id = request.data.get("preferred_transporter")
    transporter = None
    if transporter_id:
        transporter = User.objects.filter(pk=transporter_id, role="transporter").first()

    r = BuyerRequest.objects.create(
        buyer=u,
        farmer=l.farmer,
        listing=l,
        quantity=qty,
        offered_price=request.data.get("offered_price") or None,
        message=request.data.get("message", ""),
        delivery_needed=bool(request.data.get("delivery_needed")),
        delivery_district_id=request.data.get("delivery_district") or u.district_id,
        preferred_transporter=transporter
    )
    notify(l.farmer, "New Purchase Request", f"{u.full_name} requested {qty:g} {l.unit} of {l.title}.")
    emit("request.created", {"id": str(r.id), "buyer": u.full_name, "quantity": qty, "listing": l.title})
    return Response(req_d(r), 201)

def set_status(o, to, by):
    old = o.status
    o.status = to
    o.save()
    OrderStatusHistory.objects.create(order=o, old_status=old, new_status=to, changed_by=by)
    other = o.seller if o.buyer_id == by.id else o.buyer
    notify(other, f"Order {o.order_number}: {to.replace('_', ' ')}", o.item_title)
    emit("order." + to, {"id": str(o.id), "status": to})

@api_view(["PATCH"])
@role_required("farmer")
def request_decide(request, pk):
    action = request.data.get("action")
    if action not in ("accept", "reject"):
        return err("Action must be accept or reject.")
    with transaction.atomic():
        r = get_object_or_404(BuyerRequest.objects.select_for_update(), pk=pk, farmer=request.user)
        if r.status != "pending":
            return err("This request was already answered.")
        if action == "reject":
            r.status = "rejected"
            r.save()
            notify(r.buyer, "Request declined", r.listing.title)
            return Response(req_d(r))

        # Check stock atomic update
        n = ProduceListing.objects.filter(pk=r.listing_id, status="active", quantity_available__gte=r.quantity)\
            .update(quantity_available=F("quantity_available") - r.quantity, version=F("version") + 1)
        if not n:
            r.status = "cancelled"
            r.save()
            notify(r.buyer, "Request cancelled", "Stock ran out before it could be accepted.")
            return err("Not enough stock left; request cancelled.", 409)

        l = ProduceListing.objects.get(pk=r.listing_id)
        if l.quantity_available <= 0:
            l.status = "sold_out"
            l.save()

        price = r.offered_price or l.price_per_unit
        o = Order.objects.create(
            order_number=f"AC-26-{uuid.uuid4().int % 9000 + 1000}",
            request=r,
            buyer=r.buyer,
            seller=r.farmer,
            listing=l,
            item_title=l.title,
            quantity=r.quantity,
            unit=l.unit,
            unit_price=price,
            total_amount=r.quantity * price,
            delivery_required=r.delivery_needed,
            payment_status="unpaid"
        )
        OrderStatusHistory.objects.create(order=o, new_status="confirmed", changed_by=request.user)
        r.status = "accepted"
        r.save()

        if r.delivery_needed:
            trans = r.preferred_transporter
            d = Delivery.objects.create(
                order=o,
                pickup_district=l.district,
                dropoff_district=r.delivery_district or r.buyer.district or l.district,
                transporter=trans,
                status="accepted" if trans else "open"
            )
            if trans:
                DeliveryUpdate.objects.create(delivery=d, status="accepted", note=f"Assigned to chosen transporter {trans.full_name}")
                notify(trans, "New Delivery Assignment", f"You have been chosen by the buyer to deliver order {o.order_number} to {d.dropoff_district.name}.")

        notify(r.buyer, "Request accepted", f"Order {o.order_number} is confirmed.")
        emit("order.confirmed", {"id": str(o.id), "order_number": o.order_number, "delivery": r.delivery_needed})
    return Response(req_d(r))

@api_view(["GET"])
def orders(request):
    qs = Order.objects.filter(Q(buyer=request.user) | Q(seller=request.user)).select_related("buyer", "seller", "listing", "listing__crop", "listing__district")
    return Response([order_d(o, request.user) for o in qs])

@api_view(["POST"])
@role_required("buyer")
def order_pay(request, pk):
    o = get_object_or_404(Order, pk=pk, buyer=request.user)
    method = request.data.get("method", "MTN MoMo")
    o.payment_status = "held"
    o.payment_method = method
    o.save()
    OrderStatusHistory.objects.create(order=o, old_status=o.status, new_status=o.status, changed_by=request.user)
    notify(o.seller, f"Payment Held for {o.order_number}", f"Buyer paid UGX {float(o.total_amount):,}. AgriConnect escrow is holding payment safely.")
    emit("order.payment_held", {"id": str(o.id), "amount": float(o.total_amount), "method": method})
    return Response(order_d(o, request.user))

@api_view(["PATCH"])
def order_status(request, pk):
    u = request.user
    to = request.data.get("status")
    with transaction.atomic():
        o = get_object_or_404(Order.objects.select_for_update(), Q(buyer=u) | Q(seller=u), pk=pk)
        side = "seller" if o.seller_id == u.id else "buyer"
        ok = {
            ("seller", "confirmed", "ready_for_pickup"),
            ("seller", "ready_for_pickup", "delivered"),
            ("buyer", "delivered", "completed"),
            ("seller", "confirmed", "cancelled"),
            ("buyer", "confirmed", "cancelled")
        }
        if (side, o.status, to) not in ok or (to == "delivered" and o.delivery_required):
            return err("That status change is not allowed right now.")

        if to == "cancelled":
            ProduceListing.objects.filter(pk=o.listing_id).update(quantity_available=F("quantity_available") + o.quantity)
            ProduceListing.objects.filter(pk=o.listing_id, status="sold_out").update(status="active")
            Delivery.objects.filter(order=o).exclude(status="delivered").update(status="cancelled")

        if to == "completed":
            o.payment_status = "released"
            notify(o.seller, "Funds Released!", f"Buyer confirmed receipt for {o.order_number}. Payout of UGX {float(o.total_amount):,} released to your account.")

        set_status(o, to, u)
    return Response(order_d(o, u))

# ---------- transport ----------
def del_d(d):
    return dict(
        id=str(d.id),
        order_id=str(d.order_id),
        order_number=d.order.order_number,
        item=d.order.item_title,
        crop_name=d.order.listing.crop.name if d.order.listing and d.order.listing.crop else "Produce",
        quantity=float(d.order.quantity),
        unit=d.order.unit,
        total_amount=float(d.order.total_amount),
        pickup=d.pickup_district.name,
        dropoff=d.dropoff_district.name,
        pickup_phone=d.order.seller.phone,
        dropoff_phone=d.order.buyer.phone,
        farmer_name=d.order.seller.full_name,
        buyer_name=d.order.buyer.full_name,
        transporter_name=d.transporter.full_name if d.transporter else None,
        transporter_id=str(d.transporter_id) if d.transporter_id else None,
        status=d.status,
        created_at=d.created_at,
        updates=[dict(status=x.status, note=x.note, lat=float(x.lat) if x.lat else None, lng=float(x.lng) if x.lng else None, created_at=x.created_at) for x in d.updates.all()]
    )

@api_view(["GET"])
@permission_classes([AllowAny])
def available_transporters(request):
    """Returns verified transporters for buyers to select from"""
    qs = User.objects.filter(role="transporter", is_verified=True).select_related("district")
    return Response([
        dict(
            id=str(u.id),
            name=u.full_name,
            phone=u.phone,
            district=u.district.name if u.district else "Uganda",
            doc=u.verification_doc
        )
        for u in qs
    ])

@api_view(["GET"])
@role_required("transporter")
def jobs(request):
    qs = Delivery.objects.filter(status="open").select_related("order", "pickup_district", "dropoff_district", "order__seller", "order__buyer", "order__listing__crop")
    for k, f in (("from", "pickup_district__name__iexact"), ("to", "dropoff_district__name__iexact")):
        if request.query_params.get(k):
            qs = qs.filter(**{f: request.query_params[k]})
    return Response([del_d(d) for d in qs])

@api_view(["POST"])
@role_required("transporter")
def job_accept(request, pk):
    if not request.user.is_verified:
        return err("Your transporter account is awaiting admin approval.", 403)
    with transaction.atomic():
        if not Delivery.objects.filter(pk=pk, status="open").update(status="accepted", transporter=request.user):
            return err("Another transporter already accepted this delivery job.", 409)
        d = Delivery.objects.select_related("order", "order__buyer", "order__seller").get(pk=pk)
        DeliveryUpdate.objects.create(delivery=d, status="accepted", note=f"Delivery job accepted by {request.user.full_name}")
        for p in (d.order.buyer, d.order.seller):
            notify(p, "Transporter Assigned", f"{request.user.full_name} accepted delivery for order {d.order.order_number}.")
        emit("delivery.accepted", {"id": str(d.id), "transporter": request.user.full_name, "order": d.order.order_number})
    return Response(del_d(d), 200)

@api_view(["GET"])
@role_required("transporter")
def my_deliveries(request):
    qs = Delivery.objects.filter(transporter=request.user).select_related("order", "pickup_district", "dropoff_district", "order__seller", "order__buyer", "order__listing__crop").prefetch_related("updates")
    return Response([del_d(d) for d in qs])

@api_view(["PATCH"])
@role_required("transporter")
def delivery_status(request, pk):
    d = get_object_or_404(Delivery, pk=pk, transporter=request.user)
    to = request.data.get("status")
    allowed_next = {"accepted": "picked_up", "picked_up": "in_transit", "in_transit": "delivered"}
    if allowed_next.get(d.status) != to:
        return err(f"Invalid delivery transition from '{d.status}' to '{to}'. Next step is '{allowed_next.get(d.status)}'.")
    with transaction.atomic():
        d.status = to
        d.save()
        note = request.data.get("note", "")
        if not note:
            note = {
                "picked_up": f"Loaded cargo at {d.pickup_district.name}",
                "in_transit": f"On highway from {d.pickup_district.name} to {d.dropoff_district.name}",
                "delivered": f"Safely reached destination {d.dropoff_district.name}"
            }.get(to, f"Status updated to {to}")
        DeliveryUpdate.objects.create(
            delivery=d,
            status=to,
            note=note,
            lat=request.data.get("lat") or None,
            lng=request.data.get("lng") or None
        )
        if to == "picked_up":
            set_status(d.order, "in_transit", request.user)
        if to == "delivered":
            set_status(d.order, "delivered", request.user)
        emit("delivery.status_changed", {"id": str(d.id), "status": to, "note": note})
    return Response(del_d(d))

@api_view(["POST"])
@role_required("transporter")
def delivery_checkpoint(request, pk):
    d = get_object_or_404(Delivery, pk=pk, transporter=request.user)
    note = request.data.get("note", "Vehicle passing checkpoint")
    lat = request.data.get("lat")
    lng = request.data.get("lng")
    up = DeliveryUpdate.objects.create(
        delivery=d,
        status=d.status,
        note=note,
        lat=lat or None,
        lng=lng or None
    )
    notify(d.order.buyer, f"Delivery Checkpoint: {d.order.order_number}", note)
    emit("delivery.checkpoint", {"id": str(d.id), "note": note})
    return Response(del_d(d))

@api_view(["GET"])
def tracking(request, pk):
    d = get_object_or_404(
        Delivery.objects.select_related("order", "pickup_district", "dropoff_district", "transporter"),
        Q(order__buyer=request.user) | Q(order__seller=request.user) | Q(transporter=request.user) | Q(order__seller__role="admin"),
        pk=pk
    )
    return Response(del_d(d))

# ---------- notifications ----------
@api_view(["GET"])
def notifications(request):
    return Response(list(request.user.notifications.values("id", "title", "body", "is_read", "created_at")[:50]))

@api_view(["PATCH"])
def notification_read(request, pk):
    request.user.notifications.filter(pk=pk).update(is_read=True)
    return Response(status=204)

# ---------- admin ----------
@api_view(["GET"])
@role_required("admin")
def admin_users(request):
    return Response(UserS(User.objects.exclude(role="admin").order_by("is_verified", "-created_at"), many=True).data)

@api_view(["POST"])
@role_required("admin")
def verify_user(request, pk):
    """Admin preview and approval/rejection for transporters and farmers"""
    u = get_object_or_404(User, pk=pk)
    approve = bool(request.data.get("approve", True))
    u.is_verified = approve
    u.save()
    if u.is_verified:
        ProduceListing.objects.filter(farmer=u, status="pending_review").update(status="active")
        notify(u, "Account Verified!", f"Your {u.role} account has been verified by the administrator. You can now use all features.")
    else:
        notify(u, "Verification Update", f"Your {u.role} verification request was reviewed and marked as pending or rejected.")
    emit("user.verified", {"user": str(u.id), "name": u.full_name, "role": u.role, "verified": u.is_verified})
    return Response(UserS(u).data)

@api_view(["GET"])
@role_required("admin")
def admin_listings(request):
    qs = ProduceListing.objects.all().select_related("farmer", "crop", "district").order_by("-created_at")
    return Response(ListingS(qs, many=True).data)

@api_view(["PATCH"])
@role_required("admin")
def admin_listing_set(request, pk):
    l = get_object_or_404(ProduceListing, pk=pk)
    to = request.data.get("status")
    if to not in ("active", "removed", "pending_review"):
        return err("Status must be active, pending_review or removed.")
    l.status, l.is_flagged = to, False
    l.save()
    emit("listing.moderated", {"id": str(l.id), "status": to, "version": l.version})
    return Response(ListingS(l).data)

@api_view(["GET"])
@role_required("admin")
def admin_all_orders(request):
    """Admin previews all orders across the entire country"""
    qs = Order.objects.all().select_related("buyer", "seller", "listing", "listing__crop", "listing__district")
    return Response([order_d(o, request.user) for o in qs])

@api_view(["GET"])
@role_required("admin")
def admin_all_deliveries(request):
    """Admin previews all logistical shipments across the network"""
    qs = Delivery.objects.all().select_related("order", "pickup_district", "dropoff_district", "transporter", "order__buyer", "order__seller", "order__listing__crop")
    return Response([del_d(d) for d in qs])

@api_view(["GET"])
@role_required("admin")
def admin_summary(request):
    done = Order.objects.exclude(status="cancelled")
    return Response(dict(
        farmers=User.objects.filter(role="farmer").count(),
        buyers=User.objects.filter(role="buyer").count(),
        transporters=User.objects.filter(role="transporter").count(),
        unverified=User.objects.filter(is_verified=False).exclude(role="admin").count(),
        active_listings=ProduceListing.objects.filter(status="active").count(),
        orders=done.count(),
        order_value=float(done.aggregate(s=Sum("total_amount"))["s"] or 0)
    ))
