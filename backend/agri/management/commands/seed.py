from django.core.management.base import BaseCommand
from agri.models import *

D = {
    "Central": ["Kampala", "Wakiso", "Mukono", "Masaka", "Mpigi"],
    "Eastern": ["Jinja", "Mbale", "Soroti", "Tororo", "Busia"],
    "Northern": ["Lira", "Gulu", "Arua", "Kitgum", "Apac"],
    "Western": ["Mbarara", "Kabale", "Fort Portal", "Kasese", "Hoima"]
}

C = [
    ("Maize", "cereal", "kg"),
    ("Beans", "legume", "kg"),
    ("Matooke", "fruit", "bunch"),
    ("Tomatoes", "vegetable", "crate"),
    ("Cassava", "root_tuber", "kg"),
    ("Irish potatoes", "root_tuber", "bag"),
    ("Coffee", "cash_crop", "kg"),
    ("Groundnuts", "legume", "kg"),
    ("Pineapples", "fruit", "piece"),
    ("Onions", "vegetable", "bag"),
    ("Rice", "cereal", "kg"),
    ("Sweet potatoes", "root_tuber", "bag")
]

class Command(BaseCommand):
    help = "Load districts, crops and demo accounts with full superuser access for admin"

    def handle(self, *a, **o):
        for r, ds in D.items():
            for n in ds:
                District.objects.get_or_create(name=n, defaults={"region": r})
        for n, c, u in C:
            Crop.objects.get_or_create(name=n, defaults={"category": c, "default_unit": u})

        g = lambda n: District.objects.get(name=n)

        def mk(phone, name, role, dist, verified=True, doc=""):
            u, _ = User.objects.get_or_create(
                phone=phone,
                defaults=dict(
                    full_name=name,
                    role=role,
                    district=g(dist),
                    is_verified=verified,
                    verification_doc=doc,
                    is_staff=(role == "admin"),
                    is_superuser=(role == "admin")
                )
            )
            u.set_password("demo1234")
            u.is_verified = verified
            u.verification_doc = doc
            if role == "admin":
                u.is_staff = True
                u.is_superuser = True
            u.save()
            return u

        # Core Verified Demo Accounts
        f1 = mk("+256700000001", "Akello Grace", "farmer", "Lira", True, "NID-UG-88234-LR")
        f2 = mk("+256700000002", "Mugisha Peter", "farmer", "Mbarara", True, "NID-UG-77142-MB")
        b1 = mk("+256700000003", "Nakato Sarah", "buyer", "Kampala", True, "")
        t1 = mk("+256700000004", "Okot Daniel", "transporter", "Gulu", True, "PERMIT-TR-4491-GU")
        adm = mk("+256700000009", "Admin Office", "admin", "Kampala", True, "OFFICIAL-ADMIN")

        # Pending Accounts for Admin Verification Queue
        p_farmer = mk("+256700000005", "Katende Joseph", "farmer", "Masaka", False, "NID-UG-99120-MS")
        p_trans = mk("+256700000006", "Kigozi Brenda", "transporter", "Jinja", False, "PERMIT-TR-8820-JJ")

        # Produce Listings with high-quality crop pictures
        SAMPLE_IMAGES = {
            "Maize": "https://images.unsplash.com/photo-1551754655-cd27e38d2076?w=600&auto=format&fit=crop",
            "Groundnuts": "https://images.unsplash.com/photo-1567894340315-735d7c361db0?w=600&auto=format&fit=crop",
            "Beans": "https://images.unsplash.com/photo-1551462147-ff29053bfc14?w=600&auto=format&fit=crop",
            "Matooke": "https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=600&auto=format&fit=crop",
            "Tomatoes": "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=600&auto=format&fit=crop",
            "Irish potatoes": "https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=600&auto=format&fit=crop",
            "Rice": "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=600&auto=format&fit=crop",
            "Coffee": "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=600&auto=format&fit=crop",
            "Cassava": "https://images.unsplash.com/photo-1596797882870-8c33deeac224?w=600&auto=format&fit=crop"
        }

        if not ProduceListing.objects.exists():
            listings_data = [
                (f1, "Maize", "Dry maize, shelled (Super Clean)", 2000, "kg", 1100, "Lira", "A"),
                (f1, "Groundnuts", "Red groundnuts (Sorted)", 600, "kg", 4200, "Apac", "B"),
                (f1, "Beans", "Nambale beans, dried", 900, "kg", 3300, "Lira", "A"),
                (f2, "Matooke", "Bogoya & Mbwazirume bunches", 120, "bunch", 18000, "Mbarara", "A"),
                (f2, "Tomatoes", "Fresh tomatoes (Kiboko variety)", 80, "crate", 45000, "Kabale", "B"),
                (f2, "Irish potatoes", "Rwangume potatoes in sacks", 150, "bag", 90000, "Kabale", "A"),
                (f1, "Rice", "Upland rice, milled & polished", 1200, "kg", 3800, "Gulu", "A"),
                (f2, "Coffee", "Robusta kiboko, sun-dried", 500, "kg", 6200, "Fort Portal", "B"),
                (p_farmer, "Cassava", "Dried cassava chips (Awaiting Review)", 1500, "kg", 950, "Masaka", "B"),
            ]
            for fm, crop, title, q, unit, p, d, gr in listings_data:
                ProduceListing.objects.create(
                    farmer=fm,
                    crop=Crop.objects.get(name=crop),
                    title=title,
                    quantity_available=q,
                    unit=unit,
                    price_per_unit=p,
                    district=g(d),
                    quality_grade=gr,
                    image_url=SAMPLE_IMAGES.get(crop, ""),
                    status="active" if fm.is_verified else "pending_review"
                )

        # Seed sample orders & delivery
        if not Order.objects.exists():
            l_maize = ProduceListing.objects.filter(crop__name="Maize").first()
            if l_maize:
                o1 = Order.objects.create(
                    order_number="AC-26-1001",
                    buyer=b1,
                    seller=f1,
                    listing=l_maize,
                    item_title=l_maize.title,
                    quantity=500,
                    unit=l_maize.unit,
                    unit_price=l_maize.price_per_unit,
                    total_amount=500 * l_maize.price_per_unit,
                    delivery_required=True,
                    status="in_transit",
                    payment_status="held",
                    payment_method="MTN MoMo"
                )
                d1 = Delivery.objects.create(
                    order=o1,
                    transporter=t1,
                    pickup_district=g("Lira"),
                    dropoff_district=g("Kampala"),
                    status="in_transit"
                )
                DeliveryUpdate.objects.create(delivery=d1, status="accepted", note="Job accepted by Okot Daniel")
                DeliveryUpdate.objects.create(delivery=d1, status="picked_up", note="Produce collected at Lira depot, 500 kg loaded")
                DeliveryUpdate.objects.create(delivery=d1, status="in_transit", note="En route via Karuma bridge, 160 km to Kampala")

            l_matooke = ProduceListing.objects.filter(crop__name="Matooke").first()
            if l_matooke:
                o2 = Order.objects.create(
                    order_number="AC-26-1002",
                    buyer=b1,
                    seller=f2,
                    listing=l_matooke,
                    item_title=l_matooke.title,
                    quantity=30,
                    unit=l_matooke.unit,
                    unit_price=l_matooke.price_per_unit,
                    total_amount=30 * l_matooke.price_per_unit,
                    delivery_required=True,
                    status="confirmed",
                    payment_status="held",
                    payment_method="Airtel Money"
                )
                Delivery.objects.create(
                    order=o2,
                    transporter=None,
                    pickup_district=g("Mbarara"),
                    dropoff_district=g("Kampala"),
                    status="open"
                )

        self.stdout.write("Seeded database with full admin superuser permissions, verified accounts and pictures.")
