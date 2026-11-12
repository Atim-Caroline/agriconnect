from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from . import views as v

urlpatterns = [
    path("health/", v.health),
    # Auth & Users
    path("auth/register/", v.register),
    path("auth/login/", TokenObtainPairView.as_view()),
    path("auth/token/refresh/", TokenRefreshView.as_view()),
    path("users/me/", v.me),
    path("users/<uuid:pk>/verify/", v.verify_user),

    # Locations & Crops
    path("locations/districts/", v.districts),
    path("locations/crops/", v.crops),

    # Marketplace & Produce (Farmer posts)
    path("marketplace/produce/", v.produce),
    path("marketplace/produce/<uuid:pk>/", v.produce_detail),

    # Buyer Requests & Orders (Buyer purchases & selects transporter)
    path("orders/requests/", v.requests_),
    path("orders/requests/<uuid:pk>/", v.request_decide),
    path("orders/", v.orders),
    path("orders/<uuid:pk>/status/", v.order_status),
    path("orders/<uuid:pk>/pay/", v.order_pay),

    # Transport & Deliveries (Transporter activities & checkpoints)
    path("transport/transporters/", v.available_transporters),
    path("transport/jobs/", v.jobs),
    path("transport/jobs/<uuid:pk>/accept/", v.job_accept),
    path("transport/deliveries/", v.my_deliveries),
    path("transport/deliveries/<uuid:pk>/status/", v.delivery_status),
    path("transport/deliveries/<uuid:pk>/checkpoint/", v.delivery_checkpoint),
    path("transport/deliveries/<uuid:pk>/tracking/", v.tracking),

    # Notifications
    path("notifications/", v.notifications),
    path("notifications/<int:pk>/read/", v.notification_read),

    # Admin Preview Everything & Approvals
    path("admin/users/", v.admin_users),
    path("admin/listings/", v.admin_listings),
    path("admin/listings/<uuid:pk>/", v.admin_listing_set),
    path("admin/reports/summary/", v.admin_summary),
    path("admin/all_orders/", v.admin_all_orders),
    path("admin/all_deliveries/", v.admin_all_deliveries),
]
