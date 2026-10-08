from decimal import Decimal

from django.test import SimpleTestCase, TestCase

from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff
from portfolio import checks


def existing_business(name, *, phone, gps, lat=None, lng=None, momo=None, card=None, contact=None):
    owner = BusinessOwner.objects.create(
        full_name=f"Owner of {name}", login_phone=phone, password_hash="x", kyc_status=BusinessOwner.VERIFIED,
    )
    BusinessOwnerProfile.objects.create(
        business_owner=owner, business_name=name, gps_address=gps,
        business_contact_phone=contact or phone, payout_momo_number=momo, ghana_card_number=card,
        lat=Decimal(lat) if lat else None, lng=Decimal(lng) if lng else None,
    )
    return owner


class DistanceTests(SimpleTestCase):
    def test_the_same_point_is_zero(self):
        self.assertEqual(checks.distance_m(6.6885, -1.6244, 6.6885, -1.6244), 0)

    def test_one_degree_of_latitude(self):
        self.assertAlmostEqual(checks.distance_m(6.0, -1.6, 7.0, -1.6), 111195, delta=5)

    def test_stored_decimals_work_too(self):
        self.assertAlmostEqual(
            checks.distance_m(Decimal("6.688500"), Decimal("-1.624400"), Decimal("6.688770"), Decimal("-1.624400")),
            30.0, delta=0.5,
        )


class ExactDuplicateTests(TestCase):
    def test_the_same_phone_written_differently(self):
        existing_business("Adwoa Fabrics", phone="0241234567", gps="AK-039-5028")
        for written in ("+233 24 123 4567", "233241234567", "024-123-4567", "241234567"):
            with self.subTest(written=written):
                self.assertEqual(checks.exact_duplicates(phone=written), ["phone"])

    def test_a_stored_phone_with_spaces_still_matches(self):
        existing_business("Adwoa Fabrics", phone="024 123 4567", gps="AK-039-5028", momo="024-400-0111")
        self.assertEqual(checks.exact_duplicates(phone="+233241234567"), ["phone"])
        self.assertEqual(checks.exact_duplicates(phone="0244000111"), ["phone"])

    def test_a_contact_phone_or_momo_number_counts_as_the_business_phone(self):
        existing_business(
            "Adwoa Fabrics", phone="0201112223", gps="AK-039-5028", contact="0277000222", momo="0244000111",
        )
        self.assertEqual(checks.exact_duplicates(phone="+233244000111"), ["phone"])
        self.assertEqual(checks.exact_duplicates(phone="0277 000 222"), ["phone"])

    def test_ghana_post_address_and_ghana_card(self):
        existing_business("Adwoa Fabrics", phone="0201112223", gps="AK-039-5028", card="GHA-123456789-0")
        self.assertEqual(checks.exact_duplicates(gps_address=" ak-039-5028 "), ["gps_address"])
        self.assertEqual(checks.exact_duplicates(ghana_card_number="gha-123456789-0"), ["ghana_card"])
        self.assertEqual(
            checks.exact_duplicates(phone="0201112223", gps_address="AK-039-5028", ghana_card_number="GHA-123456789-0"),
            ["phone", "gps_address", "ghana_card"],
        )

    def test_the_business_itself_and_blank_values_never_match(self):
        owner = existing_business("Adwoa Fabrics", phone="0201112223", gps="AK-039-5028", card="GHA-123456789-0")
        self.assertEqual(
            checks.exact_duplicates(
                phone="0201112223", gps_address="AK-039-5028", ghana_card_number="GHA-123456789-0",
                exclude_owner_id=owner.pk,
            ),
            [],
        )
        self.assertEqual(checks.exact_duplicates(phone="", gps_address="", ghana_card_number=""), [])
        self.assertEqual(checks.exact_duplicates(phone="0209998887", gps_address="AK-039-9999"), [])


class SimilarNearbyTests(TestCase):
    def setUp(self):
        self.fabrics = existing_business(
            "Adwoa Fabrics", phone="0201110001", gps="AK-039-0001", lat="6.688500", lng="-1.624400",
        )

    def test_a_similar_name_within_50_m_comes_back_with_its_name_and_distance(self):
        # A self-registered owner has no pin and is never matched.
        existing_business("Adwoa Fabrics", phone="0201110009", gps="AK-039-0009")
        matches = checks.similar_nearby("Adwoa Fabric", 6.688770, -1.624400)
        self.assertEqual(len(matches), 1)
        self.assertEqual(
            {key: matches[0][key] for key in ("business_owner_id", "business_name", "distance_m")},
            {"business_owner_id": self.fabrics.pk, "business_name": "Adwoa Fabrics", "distance_m": 30},
        )
        self.assertAlmostEqual(matches[0]["similarity"], 0.8, places=2)

    def test_too_far_or_too_different_is_not_found(self):
        self.assertEqual(checks.similar_nearby("Adwoa Fabric", 6.689220, -1.624400), [])  # 80 m north
        existing_business("Asafo Hair Studio", phone="0201110002", gps="AK-039-0002", lat="6.688500", lng="-1.624400")
        self.assertEqual(checks.similar_nearby("Asafo Hair & Beauty", 6.688500, -1.624400), [])  # similarity 0.44

    def test_nearest_first_and_the_business_itself_left_out(self):
        nearer = existing_business(
            "Adwoa Fabrics", phone="0201110003", gps="AK-039-0003", lat="6.688680", lng="-1.624400",
        )
        matches = checks.similar_nearby("Adwoa Fabrics", 6.688860, -1.624400)
        self.assertEqual(
            [(match["business_owner_id"], match["distance_m"]) for match in matches],
            [(nearer.pk, 20), (self.fabrics.pk, 40)],
        )
        self.assertEqual(
            [match["business_owner_id"] for match in checks.similar_nearby(
                "Adwoa Fabrics", 6.688860, -1.624400, exclude_owner_id=nearer.pk,
            )],
            [self.fabrics.pk],
        )

    def test_without_a_name_or_a_pin_there_is_nothing_to_compare(self):
        self.assertEqual(checks.similar_nearby("", 6.6885, -1.6244), [])
        self.assertEqual(checks.similar_nearby("Adwoa Fabric", None, None), [])


class StaffPhoneTests(TestCase):
    def test_active_staff_with_the_same_phone_key(self):
        esi = make_staff("support", "esi@example.com", phone="055 900 0111")
        make_staff("support", "gone@example.com", phone="0559000111", is_active=False)
        make_staff("support", "abena@example.com", phone="0559000222")
        self.assertEqual(checks.staff_phone_matches("+233559000111"), [esi])
        self.assertEqual(checks.staff_phone_matches(""), [])
