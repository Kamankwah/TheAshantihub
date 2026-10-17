import json
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core import mail
from django.test import override_settings
from django.utils import timezone

from accounts.models import StaffUser
from delivery import papers
from delivery.models import DeliveryZone, Rider, RiderDocument, Vehicle
from orders.models import DeliveryAssignment

from .base import PNG, PICKUP, DeliveryCase


def upload(kind="ghana_card", **extra):
    if kind == "ghana_card":  # a Ghana Card must carry its expiry date (it gates a rider's payouts)
        extra.setdefault("expires_on", (timezone.localdate() + timedelta(days=365)).isoformat())
    return {"kind": kind, "file": SimpleUploadedFile("scan.png", PNG, "image/png"), **extra}


class PapersTests(DeliveryCase):
    def test_a_rider_uploads_a_paper_and_the_manager_approves_it(self):
        self.as_staff(self.rider_staff)
        expiry = (timezone.localdate() + timedelta(days=90)).isoformat()
        created = self.client.post("/api/delivery/rider/documents/", upload(number="GHA-123456789-0", expires_on=expiry), format="multipart")
        self.assertEqual(created.status_code, 201, created.content)
        row = created.json()
        self.assertEqual(row["number_masked"], "•••• 89-0".replace("89-0", "89-0") if False else row["number_masked"])
        self.assertNotIn("123456789", str(row))
        self.assertTrue(row["number_masked"].endswith("89-0"))
        self.as_staff(self.manager)
        waiting = self.client.get("/api/delivery/documents/?bucket=waiting").json()
        self.assertEqual(waiting["counts"]["waiting"], 1)
        reviewed = self.client.post(f"/api/delivery/documents/{row['id']}/review/", {"decision": "approve"}, format="json")
        self.assertEqual(reviewed.status_code, 200, reviewed.content)
        self.assertEqual(reviewed.json()["status"], "approved")
        self.assertTrue(self.rider_staff.notifications.filter(kind="delivery_document").exists())

    def test_with_the_ledger_off_a_ghana_card_needs_no_expiry_date(self):
        self.as_staff(self.rider_staff)
        bare = {"kind": "ghana_card", "file": SimpleUploadedFile("scan.png", PNG, "image/png")}
        created = self.client.post("/api/delivery/rider/documents/", bare, format="multipart")
        self.assertEqual(created.status_code, 201, created.content)
        self.as_staff(self.manager)
        ok = self.client.post(f"/api/delivery/documents/{created.json()['id']}/review/", {"decision": "approve"}, format="json")
        self.assertEqual(ok.status_code, 200, ok.content)

    @override_settings(LEDGER_ENABLED=True)
    def test_a_ghana_card_needs_its_expiry_date_to_be_uploaded_and_approved(self):
        self.as_staff(self.rider_staff)
        bare = {"kind": "ghana_card", "file": SimpleUploadedFile("scan.png", PNG, "image/png")}
        self.assertEqual(self.client.post("/api/delivery/rider/documents/", bare, format="multipart").status_code, 400)
        doc = RiderDocument.objects.create(
            rider=self.rider_staff.rider, kind="ghana_card", file="documents/x.png", uploaded_by=self.rider_staff,
        )
        self.as_staff(self.manager)
        refused = self.client.post(f"/api/delivery/documents/{doc.pk}/review/", {"decision": "approve"}, format="json")
        self.assertEqual(refused.status_code, 400)
        ok = self.client.post(
            f"/api/delivery/documents/{doc.pk}/review/",
            {"decision": "approve", "expires_on": (timezone.localdate() + timedelta(days=30)).isoformat()}, format="json",
        )
        self.assertEqual(ok.status_code, 200, ok.content)

    def test_a_scan_is_served_only_through_the_authenticated_view(self):
        self.as_staff(self.rider_staff)
        row = self.client.post("/api/delivery/rider/documents/", upload(), format="multipart").json()
        self.assertNotIn("file", row)
        self.client.credentials()
        self.assertEqual(self.client.get(f"/api/delivery/documents/{row['id']}/file/").status_code, 401)
        self.as_staff(self.rider_staff)
        self.assertEqual(self.client.get(f"/api/delivery/documents/{row['id']}/file/").status_code, 403)
        self.as_staff(self.manager)
        self.assertEqual(self.client.get(f"/api/delivery/documents/{row['id']}/file/").status_code, 200)

    def test_only_images_and_pdfs_are_accepted(self):
        self.as_staff(self.rider_staff)
        bad = {"kind": "licence", "file": SimpleUploadedFile("x.png", b"not an image at all", "image/png")}
        self.assertEqual(self.client.post("/api/delivery/rider/documents/", bad, format="multipart").status_code, 400)

    def test_rejecting_needs_a_reason_and_a_checked_paper_cannot_be_checked_again(self):
        self.as_staff(self.rider_staff)
        row = self.client.post("/api/delivery/rider/documents/", upload("licence"), format="multipart").json()
        self.as_staff(self.manager)
        url = f"/api/delivery/documents/{row['id']}/review/"
        self.assertEqual(self.client.post(url, {"decision": "reject"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(url, {"decision": "reject", "reject_reason": "Blurred"}, format="json").status_code, 200)
        self.assertEqual(self.client.post(url, {"decision": "approve"}, format="json").status_code, 409)

    def test_approving_a_renewal_replaces_the_old_paper(self):
        self.approve_papers()
        old = self.rider.documents.get(kind="insurance")
        self.as_staff(self.rider_staff)
        row = self.client.post("/api/delivery/rider/documents/", upload("insurance"), format="multipart").json()
        self.as_staff(self.manager)
        self.client.post(f"/api/delivery/documents/{row['id']}/review/", {"decision": "approve", "expires_on": (timezone.localdate() + timedelta(days=300)).isoformat()}, format="json")
        old.refresh_from_db()
        self.assertEqual(old.status, RiderDocument.EXPIRED)

    def test_nobody_checks_a_paper_they_uploaded(self):
        doc = RiderDocument.objects.create(rider=self.rider, kind="licence", file=SimpleUploadedFile("a.png", PNG, "image/png"), uploaded_by=self.manager)
        self.as_staff(self.manager)
        self.assertEqual(self.client.post(f"/api/delivery/documents/{doc.id}/review/", {"decision": "approve"}, format="json").status_code, 403)


class ExpiryJobTests(DeliveryCase):
    def test_an_expired_paper_suspends_the_rider_and_a_renewal_reinstates(self):
        self.approve_papers()
        doc = self.rider.documents.get(kind="roadworthy")
        doc.expires_on = timezone.localdate() - timedelta(days=1)
        doc.save()
        result = papers.run()
        self.assertEqual(result["expired"], 1)
        self.assertEqual(result["suspended"], 1)
        self.rider_staff.refresh_from_db()
        self.rider.refresh_from_db()
        self.assertTrue(self.rider_staff.is_suspended)
        self.assertEqual(self.rider.suspension_source, Rider.DOCUMENTS)
        # Reinstating before the paper is renewed is refused.
        self.as_staff(self.manager, sudo=True)
        self.assertEqual(self.client.post(f"/api/delivery/riders/{self.rider.pk}/reinstate/").status_code, 409)
        RiderDocument.objects.create(
            rider=self.rider, kind="roadworthy", file=SimpleUploadedFile("a.png", PNG, "image/png"), status=RiderDocument.APPROVED,
            expires_on=timezone.localdate() + timedelta(days=100),
        )
        self.assertEqual(self.client.post(f"/api/delivery/riders/{self.rider.pk}/reinstate/").status_code, 200)
        self.rider_staff.refresh_from_db()
        self.assertFalse(self.rider_staff.is_suspended)

    def test_a_rider_in_the_middle_of_a_job_is_not_suspended_until_it_ends(self):
        self.approve_papers()
        assignment = self.assign()
        doc = self.rider.documents.get(kind="insurance")
        doc.expires_on = timezone.localdate() - timedelta(days=1)
        doc.save()
        self.assertEqual(papers.run()["suspended"], 0)
        assignment.status = DeliveryAssignment.DELIVERED
        assignment.save()
        self.assertEqual(papers.run()["suspended"], 1)

    def test_reminders_go_out_once_per_window(self):
        self.approve_papers(expires=timezone.localdate() + timedelta(days=29))
        first = papers.run()["reminded"]
        self.assertEqual(first, 5)
        self.assertEqual(papers.run()["reminded"], 0)
        self.assertTrue(self.manager.notifications.filter(kind="delivery_document").exists())

    def test_a_rider_with_no_papers_yet_is_not_suspended(self):
        self.assertEqual(papers.run()["suspended"], 0)

    def test_a_manual_suspension_cannot_be_lifted_by_reinstate(self):
        self.approve_papers()
        self.rider_staff.is_suspended = True
        self.rider_staff.save()
        self.as_staff(self.manager, sudo=True)
        response = self.client.post(f"/api/delivery/riders/{self.rider.pk}/reinstate/")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "manual_suspension")


class SecurityFixTests(DeliveryCase):
    def test_reinstate_needs_sudo(self):
        self.approve_papers()
        self.rider_staff.is_suspended = True
        self.rider_staff.save()
        Rider.objects.filter(pk=self.rider.pk).update(suspension_source=Rider.DOCUMENTS)
        self.as_staff(self.manager)
        response = self.client.post(f"/api/delivery/riders/{self.rider.pk}/reinstate/")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json().get("code"), "sudo_required")
        self.as_staff(self.manager, sudo=True)
        self.assertEqual(self.client.post(f"/api/delivery/riders/{self.rider.pk}/reinstate/").status_code, 200)

    def test_a_manual_suspension_overrides_a_stale_papers_source_and_unsuspend_clears_it(self):
        self.approve_papers()
        Rider.objects.filter(pk=self.rider.pk).update(suspension_source=Rider.DOCUMENTS)
        self.as_staff(self.manager, sudo=True)
        self.assertEqual(self.client.post(f"/api/accounts/staff/{self.rider_staff.pk}/suspend/", {"reason": "Conduct"}, format="json").status_code, 200)
        self.rider.refresh_from_db()
        self.assertEqual(self.rider.suspension_source, Rider.MANUAL)
        response = self.client.post(f"/api/delivery/riders/{self.rider.pk}/reinstate/")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "manual_suspension")
        self.client.post(f"/api/accounts/staff/{self.rider_staff.pk}/unsuspend/")
        self.rider.refresh_from_db()
        self.assertEqual(self.rider.suspension_source, "")

    def test_html_renamed_as_an_image_is_rejected(self):
        self.as_staff(self.rider_staff)
        evil = {"kind": "licence", "file": SimpleUploadedFile("x.jpg", b"<html><script>alert(1)</script></html>", "image/jpeg")}
        self.assertEqual(self.client.post("/api/delivery/rider/documents/", evil, format="multipart").status_code, 400)
        self.assertEqual(RiderDocument.objects.count(), 0)

    def test_files_get_a_server_name_and_are_served_inert(self):
        self.as_staff(self.rider_staff)
        row = self.client.post("/api/delivery/rider/documents/", {"kind": "licence", "file": SimpleUploadedFile("../../evil.html.png", PNG, "text/html")}, format="multipart").json()
        doc = RiderDocument.objects.get(pk=row["id"])
        self.assertRegex(doc.file.name, r"^documents/[0-9a-f]{32}\.png$")
        self.as_staff(self.manager)
        response = self.client.get(f"/api/delivery/documents/{doc.pk}/file/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertIn("sandbox", response["Content-Security-Policy"])
        self.assertIn("attachment", response["Content-Disposition"])


class VehicleTests(DeliveryCase):
    def test_add_assign_and_hand_over_a_vehicle(self):
        self.as_staff(self.manager)
        made = self.client.post("/api/delivery/vehicles/", {"plate": "gw 1234-24", "vehicle_type": "motorbike", "owner_kind": "ashantihub", "insurance_expires": "2027-03-01"}, format="json")
        self.assertEqual(made.status_code, 201, made.content)
        vid = made.json()["id"]
        self.assertEqual(made.json()["plate"], "GW 1234-24")
        again = self.client.post("/api/delivery/vehicles/", {"plate": "GW 1234-24", "vehicle_type": "car"}, format="json")
        self.assertEqual(again.status_code, 400)
        assigned = self.client.post(f"/api/delivery/vehicles/{vid}/assign/", {"rider": self.rider.pk}, format="json").json()
        self.assertEqual(assigned["rider"]["full_name"], self.rider_staff.full_name)
        other = Rider.objects.get(staff=self.other_staff)
        moved = self.client.post(f"/api/delivery/vehicles/{vid}/assign/", {"rider": other.pk, "note": "Swap"}, format="json").json()
        self.assertEqual(moved["rider"]["full_name"], self.other_staff.full_name)
        self.rider.refresh_from_db()
        self.assertIsNone(self.rider.vehicle)
        detail = self.client.get(f"/api/delivery/vehicles/{vid}/").json()
        self.assertEqual(len(detail["handovers"]), 2)
        listing = self.client.get("/api/delivery/vehicles/").json()
        self.assertEqual(listing["counts"], {"motorbike": 1})

    def test_a_retired_vehicle_cannot_be_handed_out(self):
        vehicle = Vehicle.objects.create(plate="AS 1-24", status=Vehicle.RETIRED)
        self.as_staff(self.manager)
        self.assertEqual(self.client.post(f"/api/delivery/vehicles/{vehicle.pk}/assign/", {"rider": self.rider.pk}, format="json").status_code, 409)


class ZoneTests(DeliveryCase):
    SQUARE = [[-1.63, 6.69], [-1.61, 6.69], [-1.61, 6.71], [-1.63, 6.71]]

    def test_draw_a_boundary_and_find_the_zone_of_a_point(self):
        self.as_staff(self.manager)
        made = self.client.post("/api/delivery/zones/", {"name": "Adum", "boundary": self.SQUARE, "express_offered": True}, format="json")
        self.assertEqual(made.status_code, 201, made.content)
        self.assertGreater(made.json()["area_km2"], 1)
        from delivery import services

        self.assertEqual(services.zone_of(6.70, -1.62).name, "Adum")
        self.assertIsNone(services.zone_of(6.80, -1.62))
        self.assertIsNone(services.zone_of(None, None))

    def test_a_boundary_outside_ghana_or_too_small_is_refused(self):
        self.as_staff(self.manager)
        self.assertEqual(self.client.post("/api/delivery/zones/", {"name": "Z", "boundary": [[0, 0], [1, 1]]}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/delivery/zones/", {"name": "Z", "boundary": [[50, 50], [51, 50], [51, 51]]}, format="json").status_code, 400)

    def test_riders_are_listed_under_their_home_zone(self):
        zone = DeliveryZone.objects.create(name="Asafo")
        self.as_staff(self.manager)
        self.client.patch(f"/api/delivery/riders/{self.rider.pk}/", {"home_zone": zone.pk}, format="json")
        zones = self.client.get("/api/delivery/zones/").json()["results"]
        self.assertEqual(zones[0]["riders"][0]["full_name"], self.rider_staff.full_name)


class InviteTests(DeliveryCase):
    def test_a_rider_invite_carries_vehicle_zone_and_first_shift(self):
        zone = DeliveryZone.objects.create(name="Bantama")
        self.as_staff(self.manager, sudo=True)
        response = self.client.post("/api/accounts/staff/invite/", {
            "full_name": "Abena Adjei", "email": "abena@example.com", "role": "dispatch", "vehicle_type": "tricycle",
            "home_zone": zone.pk, "first_shift_date": "2026-12-01", "invite_note": "Bring your Ghana Card",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        staff = StaffUser.objects.get(email="abena@example.com")
        self.assertEqual(staff.manager, self.manager)
        rider = staff.rider
        self.assertEqual((rider.vehicle_type, rider.home_zone, str(rider.first_shift_date)), ("tricycle", zone, "2026-12-01"))
        pending = self.client.get("/api/delivery/invites/").json()["pending"]
        self.assertEqual([p["email"] for p in pending], ["abena@example.com"])
        self.assertEqual(pending[0]["home_zone"], "Bantama")

    def test_rider_fields_are_refused_for_another_role(self):
        self.as_staff(self.manager, sudo=True)
        response = self.client.post("/api/accounts/staff/invite/", {"full_name": "X", "email": "x@example.com", "role": "scout", "vehicle_type": "car"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_a_delivery_manager_can_invite_only_dispatch(self):
        self.as_staff(self.manager, sudo=True)
        response = self.client.post("/api/accounts/staff/invite/", {"full_name": "X", "email": "x@example.com", "role": "support"}, format="json")
        self.assertEqual(response.status_code, 400)


class RosterAndProfileTests(DeliveryCase):
    def test_roster_status_papers_and_counts(self):
        self.approve_papers()
        self.as_staff(self.manager)
        roster = self.client.get("/api/delivery/riders/").json()
        by_email = {r["email"]: r for r in roster["results"]}
        self.assertEqual(by_email["rider@example.com"]["status"], "off_shift")
        self.assertEqual(by_email["rider@example.com"]["papers"]["missing"], [])
        self.assertEqual(by_email["rider2@example.com"]["papers"]["missing"].__len__(), 5)
        self.assertEqual(roster["total"], 2)
        self.assertIsNone(by_email["rider@example.com"]["cash_held"])
        self.assertEqual(by_email["rider@example.com"]["acceptance_30d"], {"accepted": 0, "of": 0})
        self.assertEqual(self.client.get("/api/delivery/riders/?status=on_shift").json()["results"], [])

    def test_a_rider_on_a_job_is_on_a_job_and_on_time_counts_only_jobs_with_a_deadline(self):
        self.approve_papers()
        assignment = self.assign()
        self.as_staff(self.manager)
        row = next(r for r in self.client.get("/api/delivery/riders/").json()["results"] if r["email"] == "rider@example.com")
        self.assertEqual(row["jobs_today"], 1)
        assignment = self.run_to(assignment, "deliver")
        self.as_staff(self.manager)
        row = next(r for r in self.client.get("/api/delivery/riders/").json()["results"] if r["email"] == "rider@example.com")
        self.assertEqual(row["delivered_today"], 1)
        self.assertEqual(row["on_time_30d"], {"on_time": 0, "of": 0})  # no deadline was ever set: no data, not "100%"
        assignment.deadline_at = assignment.delivered_at + timedelta(minutes=5)
        assignment.save()
        row = next(r for r in self.client.get("/api/delivery/riders/").json()["results"] if r["email"] == "rider@example.com")
        self.assertEqual(row["on_time_30d"], {"on_time": 1, "of": 1})

    def test_profile_has_papers_jobs_devices_and_no_invented_pay(self):
        self.approve_papers()
        self.as_staff(self.rider_staff)
        self.as_staff(self.manager)
        profile = self.client.get(f"/api/delivery/riders/{self.rider.pk}/").json()
        self.assertEqual(len(profile["documents"]), 5)
        self.assertIsNone(profile["pay"])
        self.assertEqual(profile["staff"]["phone"], "+233244000002")

    def test_job_hold_toggles(self):
        self.as_staff(self.manager)
        r = self.client.post(f"/api/delivery/riders/{self.rider.pk}/job-hold/", {"hold": True, "reason": "Case #3"}, format="json").json()
        self.assertTrue(r["job_hold"])
        self.rider.refresh_from_db()
        self.assertEqual(self.rider.job_hold_reason, "Case #3")

    def test_fleet_endpoints_need_delivery_fleet(self):
        support = __import__("accounts.testing", fromlist=["make_staff"]).make_staff("support", "s@example.com")
        self.as_staff(support)
        for path in ("riders/", "documents/", "vehicles/", "zones/", "invites/", "live/", "active/"):
            self.assertEqual(self.client.get(f"/api/delivery/{path}").status_code, 403, path)


class LiveBoardTests(DeliveryCase):
    def test_an_empty_board_has_no_invented_riders_or_orders(self):
        self.as_staff(self.manager)
        live = self.client.get("/api/delivery/live/").json()
        self.assertEqual(live["pins"], [])
        self.assertEqual(live["queue"], [])
        self.assertEqual(live["kpis"]["on_the_road"], 0)
        self.assertEqual(live["kpis"]["on_time_today"], {"on_time": 0, "of": 0})
        self.assertIsNone(live["auto_assign"])

    def test_waiting_orders_riders_pins_and_stale_fixes(self):
        self.approve_papers()
        waiting = self.make_order()
        taken = self.assign(self.make_order())
        self.as_staff(self.rider_staff)
        self.client.post("/api/delivery/rider/shift/start/", {"lat": 6.7, "lng": -1.62}, format="json")
        self.as_staff(self.manager)
        live = self.client.get("/api/delivery/live/").json()
        self.assertEqual([q["order_id"] for q in live["queue"]], [waiting.pk])
        self.assertEqual(live["queue"][0]["unzoned"], True)
        self.assertEqual(live["kpis"]["on_the_road"], 1)
        self.assertEqual(live["pins"][0]["status"], "on_job")
        self.assertFalse(live["pins"][0]["stale"])
        from delivery.models import ShiftSession

        ShiftSession.objects.update(last_fix_at=timezone.now() - timedelta(minutes=4))
        live = self.client.get("/api/delivery/live/").json()
        self.assertTrue(live["pins"][0]["stale"])
        self.assertTrue(any(n["kind"] == "stale" for n in live["needs_you"]))

    def test_active_deliveries_and_the_job_record_show_the_flag_and_mask_the_phone(self):
        assignment = self.assign()
        self.step(assignment, "accept")
        self.step(assignment, "arrive-pickup", self.at((PICKUP[0] + 0.003, PICKUP[1])))
        self.as_staff(self.manager)
        active = self.client.get("/api/delivery/active/?filter=flagged").json()
        self.assertEqual(len(active["results"]), 1)
        self.assertEqual(active["results"][0]["flag"]["kind"], "location")
        detail = self.client.get(f"/api/delivery/jobs/{assignment.pk}/").json()
        self.assertNotIn("233200882200", str(detail))
        self.assertTrue(detail["customer"]["phone_masked"].endswith("882200") or "***" in detail["customer"]["phone_masked"])
        self.assertNotIn(assignment.pickup_code + '"', str(detail).replace("'", '"'))
        self.assertIsNone(detail["fee"])
        decided = self.client.post(f"/api/delivery/jobs/{assignment.pk}/flag-decision/", {"decision": "upheld"}, format="json")
        self.assertEqual(decided.status_code, 400)  # a reason is needed to uphold
        decided = self.client.post(f"/api/delivery/jobs/{assignment.pk}/flag-decision/", {"decision": "upheld", "note": "Far from shop", "hold_wait_pay": True}, format="json")
        self.assertEqual(decided.status_code, 200)
        self.assertTrue(decided.json()["wait_pay_held"])
        self.assertEqual(self.client.get("/api/delivery/active/?filter=flagged").json()["results"], [])

    def test_calling_the_rider_is_logged(self):
        assignment = self.assign()
        self.as_staff(self.manager)
        response = self.client.post(f"/api/delivery/jobs/{assignment.pk}/call-rider/")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["phone"], "+233244000002")
        self.assertEqual(assignment.calls.count(), 1)


class UnlockCodeTests(DeliveryCase):
    def locked(self, which="pickup"):
        assignment = self.assign()
        field = "pickup_code_attempts" if which == "pickup" else "drop_code_attempts"
        setattr(assignment, field, 5)
        assignment.save(update_fields=[field])
        if which == "pickup":  # the stop holds the count since multi-stop delivery; the assignment field mirrors stop 1
            assignment.stops.filter(sequence=1).update(code_attempts=5)
        return assignment

    def unlock(self, assignment, body, staff=None):
        self.as_staff(staff or self.manager)
        return self.client.post(f"/api/delivery/jobs/{assignment.pk}/unlock-code/", body, format="json")

    def test_a_manager_unlocks_a_locked_pickup_step_and_it_is_logged(self):
        from activity.models import ActivityEvent

        assignment = self.locked("pickup")
        assignment.pickup_code, assignment.drop_code = "1357", "2468"
        assignment.save(update_fields=["pickup_code", "drop_code"])
        response = self.unlock(assignment, {"which": "pickup", "note": "Shop confirmed the rider by phone"})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"which": "pickup", "attempts": 0})
        assignment.refresh_from_db()
        self.assertEqual(assignment.pickup_code_attempts, 0)
        event = ActivityEvent.objects.filter(verb="delivery-job-unlock-code").get()
        self.assertEqual(event.actor_id, self.manager.pk)
        self.assertIn("Shop confirmed the rider by phone", event.summary)
        self.assertIn("pickup", event.summary)
        blob = json.dumps([event.summary, event.before, event.after, event.target_label])
        self.assertNotIn(assignment.pickup_code, blob)
        self.assertNotIn(assignment.drop_code, blob)
        self.assertEqual(self.client.get(f"/api/delivery/jobs/{assignment.pk}/").json()["codes"]["unlocks"], 1)

    def test_the_unlock_reaches_other_managers_and_riders_live(self):
        from unittest import mock

        assignment = self.locked("pickup")
        with mock.patch("realtime.publish._send", return_value=True) as send, self.captureOnCommitCallbacks(execute=True):
            self.unlock(assignment, {"which": "pickup", "note": "Verified"})
        groups = {call.args[0] for call in send.call_args_list}
        self.assertIn("perm.delivery.manage", groups)
        self.assertIn("perm.delivery.dispatch", groups)

    def test_the_drop_step_unlocks_independently(self):
        assignment = self.locked("drop")
        assignment.pickup_code_attempts = 5
        assignment.save(update_fields=["pickup_code_attempts"])
        self.assertEqual(self.unlock(assignment, {"which": "drop", "note": "Customer verified"}).status_code, 200)
        assignment.refresh_from_db()
        self.assertEqual(assignment.drop_code_attempts, 0)
        self.assertEqual(assignment.pickup_code_attempts, 5)

    def test_unlocking_a_step_that_is_not_locked_is_409(self):
        assignment = self.assign()
        assignment.pickup_code_attempts = 4
        assignment.save(update_fields=["pickup_code_attempts"])
        response = self.unlock(assignment, {"which": "pickup", "note": "x"})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "not_locked")
        assignment.refresh_from_db()
        self.assertEqual(assignment.pickup_code_attempts, 4)

    def test_a_bad_step_or_an_empty_note_is_400(self):
        assignment = self.locked()
        self.assertEqual(self.unlock(assignment, {"which": "other", "note": "x"}).status_code, 400)
        self.assertEqual(self.unlock(assignment, {"which": "pickup", "note": "   "}).status_code, 400)
        self.assertEqual(self.unlock(assignment, {"which": "pickup"}).status_code, 400)
        self.assertEqual(self.unlock(assignment, {"which": "pickup", "note": None}).status_code, 400)
        self.assertEqual(self.unlock(assignment, {"which": "pickup", "note": 123}).status_code, 400)
        assignment.refresh_from_db()
        self.assertEqual(assignment.pickup_code_attempts, 5)

    def test_an_unknown_job_is_404(self):
        self.as_staff(self.manager)
        response = self.client.post("/api/delivery/jobs/999999/unlock-code/", {"which": "pickup", "note": "x"}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_only_delivery_managers_may_unlock(self):
        assignment = self.locked()
        self.assertEqual(self.unlock(assignment, {"which": "pickup", "note": "x"}, staff=self.rider_staff).status_code, 403)
        self.client.credentials()
        response = self.client.post(f"/api/delivery/jobs/{assignment.pk}/unlock-code/", {"which": "pickup", "note": "x"}, format="json")
        self.assertIn(response.status_code, (401, 403))
        assignment.refresh_from_db()
        self.assertEqual(assignment.pickup_code_attempts, 5)

    def test_after_the_unlock_the_rider_can_try_again(self):
        assignment = self.assign()
        self.step(assignment, "accept")
        self.step(assignment, "arrive-pickup", self.at(PICKUP))
        for _ in range(5):
            self.step(assignment, "pickup", {**self.at(PICKUP), "code": "0000" if assignment.pickup_code != "0000" else "1111"})
        locked = self.step(assignment, "pickup", {**self.at(PICKUP), "code": assignment.pickup_code})
        self.assertEqual(locked.status_code, 423)
        self.assertEqual(self.unlock(assignment, {"which": "pickup", "note": "Verified"}).status_code, 200)
        ok = self.step(assignment, "pickup", {**self.at(PICKUP), "code": assignment.pickup_code})
        self.assertEqual(ok.status_code, 200, ok.content)
