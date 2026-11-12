import uuid
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models

ROLES = [(r, r) for r in ("farmer", "buyer", "transporter", "supplier", "admin")]

class District(models.Model):
    name = models.CharField(max_length=80, unique=True)
    region = models.CharField(max_length=20)
    class Meta: ordering = ["name"]; db_table = "districts"

class Crop(models.Model):
    name = models.CharField(max_length=80, unique=True)
    category = models.CharField(max_length=30, default="other")
    default_unit = models.CharField(max_length=20, default="kg")
    class Meta: ordering = ["name"]; db_table = "crops"

class UserManager(BaseUserManager):
    def create_user(self, phone, password=None, **kw):
        u = self.model(phone=phone, **kw); u.set_password(password); u.save(); return u
    def create_superuser(self, phone, password, **kw):
        kw.update(role="admin", is_staff=True, is_superuser=True, is_verified=True)
        return self.create_user(phone, password, **kw)

class User(AbstractBaseUser, PermissionsMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    full_name = models.CharField(max_length=150)
    phone = models.CharField(max_length=20, unique=True)
    email = models.EmailField(unique=True, null=True, blank=True)
    role = models.CharField(max_length=20, choices=ROLES)
    district = models.ForeignKey(District, null=True, blank=True, on_delete=models.SET_NULL)
    verification_doc = models.CharField(max_length=100, blank=True, default="")
    preferred_language = models.CharField(max_length=10, default="en")
    is_verified = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    USERNAME_FIELD = "phone"; REQUIRED_FIELDS = ["full_name"]
    objects = UserManager()
    class Meta: db_table = "users"

class ProduceListing(models.Model):
    STATUS = ["draft", "pending_review", "active", "reserved", "sold_out", "expired", "removed"]
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    farmer = models.ForeignKey(User, on_delete=models.CASCADE, related_name="listings")
    crop = models.ForeignKey(Crop, on_delete=models.PROTECT)
    title = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    quantity_available = models.DecimalField(max_digits=12, decimal_places=2)
    unit = models.CharField(max_length=20, default="kg")
    price_per_unit = models.DecimalField(max_digits=12, decimal_places=2)
    quality_grade = models.CharField(max_length=20, default="ungraded")
    district = models.ForeignKey(District, on_delete=models.PROTECT)
    pickup_location = models.TextField(blank=True)
    image = models.ImageField(upload_to="produce/", null=True, blank=True)
    image_url = models.TextField(blank=True, default="")
    status = models.CharField(max_length=15, default="draft", choices=[(s, s) for s in STATUS])
    is_flagged = models.BooleanField(default=False)
    version = models.IntegerField(default=1)  # bumped on every change; resolves sync conflicts
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    def save(self, *a, **k):
        if not self._state.adding: self.version += 1
        super().save(*a, **k)
    class Meta: ordering = ["-created_at"]; db_table = "produce_listings"

class BuyerRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    buyer = models.ForeignKey(User, on_delete=models.CASCADE, related_name="requests_sent")
    farmer = models.ForeignKey(User, on_delete=models.CASCADE, related_name="requests_received")
    listing = models.ForeignKey(ProduceListing, on_delete=models.CASCADE)
    quantity = models.DecimalField(max_digits=12, decimal_places=2)
    offered_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    message = models.TextField(blank=True)
    delivery_needed = models.BooleanField(default=False)
    delivery_district = models.ForeignKey(District, null=True, blank=True, on_delete=models.SET_NULL)
    preferred_transporter = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    status = models.CharField(max_length=15, default="pending")  # pending|accepted|rejected|cancelled|expired
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta: ordering = ["-created_at"]; db_table = "buyer_requests"

class Order(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_number = models.CharField(max_length=20, unique=True)
    request = models.OneToOneField(BuyerRequest, null=True, on_delete=models.SET_NULL)
    buyer = models.ForeignKey(User, on_delete=models.CASCADE, related_name="orders_bought")
    seller = models.ForeignKey(User, on_delete=models.CASCADE, related_name="orders_sold")
    listing = models.ForeignKey(ProduceListing, null=True, on_delete=models.SET_NULL)
    item_title = models.CharField(max_length=150)   # snapshot so history stays correct
    quantity = models.DecimalField(max_digits=12, decimal_places=2)
    unit = models.CharField(max_length=20)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    total_amount = models.DecimalField(max_digits=14, decimal_places=2)
    delivery_required = models.BooleanField(default=False)
    status = models.CharField(max_length=20, default="confirmed")
    payment_status = models.CharField(max_length=20, default="unpaid")  # unpaid | held | released
    payment_method = models.CharField(max_length=50, blank=True, default="Mobile Money")
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta: ordering = ["-created_at"]; db_table = "orders"

class OrderStatusHistory(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="history")
    old_status = models.CharField(max_length=20, blank=True)
    new_status = models.CharField(max_length=20)
    changed_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta: db_table = "order_status_history"

class Delivery(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.OneToOneField(Order, on_delete=models.CASCADE)
    transporter = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    pickup_district = models.ForeignKey(District, on_delete=models.PROTECT, related_name="+")
    dropoff_district = models.ForeignKey(District, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=15, default="open")  # open|accepted|picked_up|in_transit|delivered|cancelled
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta: ordering = ["-created_at"]; db_table = "deliveries"

class DeliveryUpdate(models.Model):
    delivery = models.ForeignKey(Delivery, on_delete=models.CASCADE, related_name="updates")
    status = models.CharField(max_length=15)
    note = models.CharField(max_length=300, blank=True)
    lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta: ordering = ["created_at"]; db_table = "delivery_updates"

class Notification(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="notifications")
    title = models.CharField(max_length=150)
    body = models.TextField(blank=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta: ordering = ["-created_at"]; db_table = "notifications"

class SyncEvent(models.Model):  # transactional outbox: written in the same transaction as the change
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event_type = models.CharField(max_length=50)
    payload = models.JSONField(default=dict)
    status = models.CharField(max_length=15, default="pending")  # pending|acknowledged|failed|dead
    attempts = models.IntegerField(default=0)
    next_attempt_at = models.DateTimeField(auto_now_add=True)
    last_error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta: ordering = ["created_at"]; db_table = "sync_events"
