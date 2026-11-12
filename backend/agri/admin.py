from django.contrib import admin
from django.utils.html import format_html
from . import models

@admin.register(models.User)
class UserAdmin(admin.ModelAdmin):
    list_display = ("phone", "full_name", "role", "district", "verification_doc", "is_verified", "is_staff", "is_superuser", "created_at")
    list_filter = ("role", "is_verified", "is_staff", "is_superuser", "district")
    search_fields = ("phone", "full_name", "email", "verification_doc")
    ordering = ("-created_at",)
    actions = ["approve_users", "reject_users"]

    @admin.action(description="Approve & Verify selected users")
    def approve_users(self, request, queryset):
        count = queryset.update(is_verified=True)
        # Also activate pending listings for approved farmers
        for u in queryset.filter(role="farmer"):
            models.ProduceListing.objects.filter(farmer=u, status="pending_review").update(status="active")
        self.message_user(request, f"{count} user(s) approved and verified successfully.")

    @admin.action(description="Reject verification for selected users")
    def reject_users(self, request, queryset):
        count = queryset.update(is_verified=False)
        self.message_user(request, f"{count} user(s) marked unverified/rejected.")

@admin.register(models.ProduceListing)
class ProduceListingAdmin(admin.ModelAdmin):
    list_display = ("title", "thumbnail", "farmer", "crop", "quantity_available", "unit", "price_per_unit", "quality_grade", "district", "status", "created_at")
    list_filter = ("status", "crop", "district", "quality_grade")
    search_fields = ("title", "description", "farmer__full_name", "farmer__phone")
    actions = ["approve_listings", "remove_listings"]

    def thumbnail(self, obj):
        src = obj.image.url if obj.image else obj.image_url
        if src:
            return format_html('<img src="{}" style="width:45px; height:45px; object-fit:cover; border-radius:8px;" />', src)
        return "🌱 No photo"
    thumbnail.short_description = "Photo"

    @admin.action(description="Approve selected listings (Set Active)")
    def approve_listings(self, request, queryset):
        count = queryset.update(status="active", is_flagged=False)
        self.message_user(request, f"{count} listing(s) approved and set to Active.")

    @admin.action(description="Remove selected listings")
    def remove_listings(self, request, queryset):
        count = queryset.update(status="removed")
        self.message_user(request, f"{count} listing(s) marked as Removed.")

@admin.register(models.Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ("order_number", "item_title", "buyer", "seller", "quantity", "unit", "total_amount", "payment_status", "status", "delivery_required", "created_at")
    list_filter = ("status", "payment_status", "delivery_required")
    search_fields = ("order_number", "item_title", "buyer__full_name", "seller__full_name")
    ordering = ("-created_at",)

@admin.register(models.Delivery)
class DeliveryAdmin(admin.ModelAdmin):
    list_display = ("order", "transporter", "pickup_district", "dropoff_district", "status", "created_at")
    list_filter = ("status", "pickup_district", "dropoff_district")
    search_fields = ("order__order_number", "transporter__full_name", "transporter__phone")

@admin.register(models.DeliveryUpdate)
class DeliveryUpdateAdmin(admin.ModelAdmin):
    list_display = ("delivery", "status", "note", "created_at")
    list_filter = ("status",)
    search_fields = ("note", "delivery__order__order_number")

@admin.register(models.BuyerRequest)
class BuyerRequestAdmin(admin.ModelAdmin):
    list_display = ("listing", "buyer", "farmer", "quantity", "offered_price", "delivery_needed", "preferred_transporter", "status", "created_at")
    list_filter = ("status", "delivery_needed")
    search_fields = ("listing__title", "buyer__full_name", "farmer__full_name")

@admin.register(models.Crop)
class CropAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "default_unit")
    search_fields = ("name", "category")

@admin.register(models.District)
class DistrictAdmin(admin.ModelAdmin):
    list_display = ("name", "region")
    list_filter = ("region",)
    search_fields = ("name", "region")

@admin.register(models.Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("user", "title", "is_read", "created_at")
    list_filter = ("is_read",)
    search_fields = ("title", "body", "user__full_name")
