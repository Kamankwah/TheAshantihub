"""Staff panels show a business's structured weekly hours (accounts.BusinessHours), never a false 'Not given'."""
from accounts import hours
from portfolio.tests.health_fixtures import make_business

from .test_portfolio_api import PortfolioApiBase, TEST_MEDIA_ROOT, URL  # noqa: F401
from django.test import override_settings

DAYS = [{"weekday": d, "closed": d == 6, "opens": None if d == 6 else "08:00", "closes": None if d == 6 else "18:00"} for d in range(7)]


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class StaffHoursTests(PortfolioApiBase):
    def setUp(self):
        super().setUp()
        self.owner = make_business("Hours Shop", manager=self.kwame, phone="+233241119999")
    def test_business_page_and_review_sheet_carry_structured_hours(self):
        hours.set_week(self.owner, DAYS)
        self.auth(self.boss)
        page = self.client.get(f"{URL}{self.owner.pk}/").json()
        self.assertEqual(len(page["hours"]), 7)
        self.assertEqual(page["hours"][0], {"weekday": 0, "closed": False, "opens": "08:00", "closes": "18:00"})
        self.assertTrue(page["hours"][6]["closed"])
        sheet = self.client.get(f"{URL}{self.owner.pk}/review/").json()
        self.assertEqual(sheet["business"]["hours"], page["hours"])

    def test_no_structured_hours_is_an_empty_list_never_invented(self):
        self.auth(self.boss)
        self.assertEqual(self.client.get(f"{URL}{self.owner.pk}/").json()["hours"], [])
        self.assertEqual(self.client.get(f"{URL}{self.owner.pk}/review/").json()["business"]["hours"], [])
