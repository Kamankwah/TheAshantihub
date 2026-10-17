"""Who a rider works for (spec §1 rows 4-5, §2.2, §7; wallets Plan 5).

AshantiHub's own rider (`Rider.ASHANTIHUB`, the default for every rider): no wallet, every delivery fee they carry is
AshantiHub's income, and their pay stays with payroll (the rate card's `rider_pay` record). A third-party rider
(`Rider.THIRD_PARTY`, from a rider company, not an AshantiHub employee): the delivery fee of each order they deliver while
they are third-party (inside one of their `RiderEmploymentPeriod` rows) is paid into their wallet when the order's money
is released (ledger.riders), less AshantiHub's commission.

The flag decides whether a delivery fee becomes AshantiHub's income or a third party's withdrawable money, so it changes
only through the `delivery.rider_employment` approval: a Delivery Manager (delivery.fleet) proposes, a Super Admin
approves with the password (a Super Admin's own change applies at once and needs the password too). Switching a rider back to AshantiHub's own is
refused while they still have money with AshantiHub, a withdrawal on its way, or a delivered order whose money Support has
not released yet (`money_open`). That is checked when proposed, when approved, and again under the rider row's lock when
applied; a release takes the same lock before paying a rider (ledger.riders.rider_for_release)."""
from django.db.models import CharField, Exists, OuterRef, Q, Value
from django.db.models.functions import Cast, Concat
from django.utils import timezone

from approvals import services as approvals
from approvals.models import ApprovalRequest
from approvals.services import MakerCannotDecide
from approvals.registry import ApprovalKind
from ledger.models import Journal
from orders.models import DeliveryAssignment, Order

from .models import Rider, RiderDocument, RiderEmploymentPeriod

KIND = "delivery.rider_employment"
WALLET_DISABLED = "Wallets are for third-party riders. AshantiHub's own riders are paid through payroll."
OPEN_LABELS = {
    "balance": "money in their wallet (to withdraw, or owed after a refund)",
    "reserve": "commission held until the end of the day",
    "withdrawal": "a withdrawal on its way",
    "delivery_in_progress": "a delivery in progress",
    "deliveries": "delivered orders waiting for Support's call",
}


class EmploymentError(Exception):
    def __init__(self, message, code, status_code=400, field=None, **extra):
        super().__init__(message)
        self.message, self.code, self.status_code, self.field, self.extra = message, code, status_code, field, extra

    def body(self):
        data = {"detail": self.message, "code": self.code, **self.extra}
        if self.field:
            data["field"] = self.field
        return data


def is_third_party(rider):
    return rider is not None and rider.employment == Rider.THIRD_PARTY and rider.third_party_since is not None


def third_party_at(rider, when):
    """True when `rider` was a third-party rider at `when` (inside one of their employment periods, the start inclusive and
    the end exclusive). History reads the periods, never the current flag."""
    if rider is None or when is None:
        return False
    return rider.employment_periods.filter(started_at__lte=when).filter(Q(ended_at__isnull=True) | Q(ended_at__gt=when)).exists()


def wallet_rider(staff):
    """The staff member's Rider when they are a third-party rider (their wallet is on), else None. The staff member must
    still hold the Dispatch role: a re-roled ex-rider keeps a Rider row but no wallet (and no step-up codes)."""
    if getattr(staff, "pk", None) is None:
        return None
    return Rider.objects.select_related("staff").filter(
        staff_id=staff.pk, staff__role__name="dispatch", employment=Rider.THIRD_PARTY, third_party_since__isnull=False,
    ).first()


def id_verified(rider, today=None):
    """An approved Ghana Card in date is on file (the Delivery Manager reviews riders' papers). The name on the rider's
    staff account is then their verified name for payout destinations (wallets.names)."""
    today = today or timezone.localdate()
    return rider.documents.filter(kind=RiderDocument.GHANA_CARD, status=RiderDocument.APPROVED).filter(
        Q(expires_on__isnull=True) | Q(expires_on__gte=today)
    ).exists()


def _in_a_period():
    """Exists() over the assignment's rider's employment periods that contain its delivered_at (start inclusive, end
    exclusive). All periods count, past ones included."""
    return Exists(RiderEmploymentPeriod.objects.filter(
        rider__staff_id=OuterRef("dispatch_id"), started_at__lte=OuterRef("delivered_at"),
    ).filter(Q(ended_at__isnull=True) | Q(ended_at__gt=OuterRef("delivered_at"))))


def _with_keys(jobs):
    return jobs.annotate(
        pay_key=Concat(Value("order-pay-"), Cast("order_id", CharField())),
        release_key=Concat(Value("order-release-"), Cast("order_id", CharField())),
    )


def unreleased_deliveries(rider):
    """Door-to-door orders this rider delivered while third-party (in ANY of their employment periods, so a switch back
    cannot hide one) whose payment the ledger recorded and whose money is not released yet (Support's call is still to
    come), and not refunded whole."""
    jobs = _with_keys(
        DeliveryAssignment.objects.filter(
            dispatch_id=rider.staff_id, order__status=Order.PAID, order__delivery_method=Order.DOOR_TO_DOOR,
        ).filter(_in_a_period())
        .exclude(status=DeliveryAssignment.FAILED).exclude(order__refunds__whole=True)
    )
    return jobs.filter(Exists(Journal.objects.filter(key=OuterRef("pay_key")))).exclude(
        Exists(Journal.objects.filter(key=OuterRef("release_key")))
    )


def payroll_jobs(jobs):
    """`jobs` (a DeliveryAssignment queryset) without the deliveries the rider's wallet will be paid for: delivered while
    the rider was third-party (inside one of their RiderEmploymentPeriod rows, past ones included) AND whose order has an
    `order-pay-<order id>` journal (exactly what a release can pay). A delivery with no payment journal (the ledger off, or
    an order paid before it was switched on) is never paid into a wallet, so payroll keeps counting it: otherwise nobody
    would pay the rider. Used by the payroll screens (delivery.views_rules RiderEarnedView / RiderEarningsLinesView) and the
    rider app's rider/earnings/ figures."""
    walleted = _with_keys(jobs.filter(_in_a_period())).filter(Exists(Journal.objects.filter(key=OuterRef("pay_key"))))
    return jobs.exclude(pk__in=walleted.values("pk"))


def money_open(rider, lock=False):
    """What stops this rider's wallet closing now, as OPEN_LABELS keys in a fixed order ([] when nothing does). With
    `lock` (inside the decision's transaction, after the rider row's lock: rider row, then accounts, the global order) the
    rider's existing balance and reserve accounts are locked and the decision is made on those locked balances."""
    from ledger import posting
    from ledger.models import Account
    from otp.identity import ref
    from wallets.models import Withdrawal

    staff, found = rider.staff, []
    if lock:
        held = list(Account.objects.filter(
            kind__in=(Account.RIDER_BALANCE, Account.RIDER_RESERVE), owner_type=staff._meta.label_lower, owner_id=str(staff.pk),
        ))
        locked = posting.lock(*held)
        balance = {account.kind: locked[account.pk].balance for account in held}
    else:
        balance = {kind: posting.balance_of(kind, staff) for kind in (Account.RIDER_BALANCE, Account.RIDER_RESERVE)}
    if balance.get(Account.RIDER_BALANCE, 0) != 0:
        found.append("balance")
    if balance.get(Account.RIDER_RESERVE, 0) != 0:
        found.append("reserve")
    holder_type, holder_id = ref(staff)
    if Withdrawal.objects.filter(holder_type=holder_type, holder_id=holder_id, status__in=Withdrawal.OPEN).exists():
        found.append("withdrawal")
    if DeliveryAssignment.objects.filter(dispatch_id=rider.staff_id, status__in=DeliveryAssignment.ACTIVE_STATUSES).exists():
        found.append("delivery_in_progress")        # an unlocked read: locking assignments would cycle with deliver -> order
    if unreleased_deliveries(rider).exists():
        found.append("deliveries")
    return found


def clean(data):
    """(employment, company_name) from a request body or an approval payload. Raises EmploymentError (400)."""
    employment = data.get("employment")
    if employment not in (Rider.ASHANTIHUB, Rider.THIRD_PARTY):
        raise EmploymentError("Choose AshantiHub's own rider or a third-party rider.", "invalid", field="employment")
    if employment == Rider.ASHANTIHUB:
        return employment, ""
    company = str(data.get("company_name") or "").strip()
    if not 2 <= len(company) <= 120:
        raise EmploymentError("Name the rider company (2 to 120 characters).", "invalid", field="company_name")
    return employment, company


def check(rider, employment, company, maker=None, lock=False):
    """Raise EmploymentError when this change cannot be made now. `maker` is the staff member who proposed it: nobody
    changes who they themselves work for (a Super Admin holds every permission, and their own change applies at once, so
    without this rule they could route delivery fees into their own wallet)."""
    if maker is not None and maker.pk == rider.staff_id:
        raise EmploymentError("You can't change who you work for.", "own_rider", 403)
    if employment == Rider.THIRD_PARTY and getattr(rider.staff.role, "name", "") != "dispatch":
        raise EmploymentError("Only a Dispatch rider can be a third-party rider.", "not_a_rider", 409)
    if rider.employment == employment and rider.company_name == company:
        raise EmploymentError("Nothing would change.", "no_change", 409)
    if employment == Rider.ASHANTIHUB and rider.employment == Rider.THIRD_PARTY:
        found = money_open(rider, lock=lock)
        if found:
            raise EmploymentError(
                "This rider still has " + "; ".join(OPEN_LABELS[key] for key in found) + ". Settle that first.",
                "rider_money_open", 409, open=found,
            )


def pending_for(rider):
    return ApprovalRequest.objects.filter(
        kind=KIND, status=ApprovalRequest.PENDING, target_type=Rider._meta.label_lower, target_id=str(rider.pk),
    ).select_related("maker").first()


def _label(employment, company):
    label = dict(Rider.EMPLOYMENT_CHOICES).get(employment, employment or "")
    return f"{label} ({company})" if company else label


def propose(maker, rider, data, *, note="", request=None):
    """Stage the change for a Super Admin (applied at once when the maker is one). Returns the ApprovalRequest; raises
    EmploymentError."""
    employment, company = clean(data if isinstance(data, dict) else {})
    if pending_for(rider) is not None:
        raise EmploymentError("A change for this rider is already waiting for approval.", "already_pending", 409)
    check(rider, employment, company, maker)
    try:
        return approvals.submit(
            maker, KIND, title=f"{rider.staff.full_name}: {_label(employment, company)}",
            payload={"rider_id": rider.pk, "employment": employment, "company_name": company},
            target=rider, maker_note=str(note or "")[:500], request=request,
        )
    except approvals.ApprovalError as exc:
        raise EmploymentError(exc.message, "refused", exc.status_code) from exc


def row(rider):
    """What the fleet screens show of a rider's employment, with any change waiting for approval."""
    pending = pending_for(rider)
    return {
        "employment": rider.employment, "employment_label": rider.get_employment_display(),
        "company_name": rider.company_name, "third_party_since": rider.third_party_since, "wallet": is_third_party(rider) and getattr(rider.staff.role, "name", "") == "dispatch",
        "pending": None if pending is None else {
            "approval_id": pending.pk, "employment": pending.payload.get("employment"),
            "company_name": pending.payload.get("company_name"), "proposed_by": pending.maker.full_name,
            "created_at": pending.created_at,
        },
    }


# --- the approval kind --------------------------------------------------------------------------------------------

def _rider(request):
    return Rider.objects.select_related("staff").get(pk=request.payload["rider_id"])


def current_state(request):
    rider = _rider(request)
    return {"employment": rider.employment, "company_name": rider.company_name}


def validate(request):
    try:
        employment, company = clean(request.payload)
        check(_rider(request), employment, company, request.maker)
    except EmploymentError as exc:
        raise approvals.ApprovalError(exc.message) from exc


def apply(request):
    """Inside the decision's transaction: lock the rider row, check again (a release locks it before paying a rider), set
    the flag. Becoming third-party opens an employment period and sets `third_party_since` (the open period's start);
    a new company name changes neither; going back closes the period and clears `third_party_since`."""
    from activity.services import record

    decider = request.decided_by or request.maker
    rider = Rider.objects.select_for_update(of=("self",)).select_related("staff").get(pk=request.payload["rider_id"])
    now = timezone.now()          # right after the rider lock, before the checks: a delivery finished later is after this moment
    if decider.pk == rider.staff_id:
        raise MakerCannotDecide("You can't change who you work for.")
    try:
        employment, company = clean(request.payload)
        check(rider, employment, company, request.maker, lock=True)
    except EmploymentError as exc:
        raise approvals.ApprovalError(exc.message) from exc
    before = {"employment": rider.employment, "company_name": rider.company_name}
    if employment == Rider.THIRD_PARTY and rider.employment != Rider.THIRD_PARTY:
        rider.third_party_since = now
        RiderEmploymentPeriod.objects.create(rider=rider, started_at=now)
    elif employment == Rider.ASHANTIHUB:
        rider.third_party_since = None
        rider.employment_periods.filter(ended_at__isnull=True).update(ended_at=now)
    rider.employment, rider.company_name = employment, company
    rider.save(update_fields=["employment", "company_name", "third_party_since"])
    # Last: record() holds the activity chain lock until commit.
    record(
        decider, "delivery.rider_employment_applied", target=rider,
        summary=f"{rider.staff.full_name}: {_label(employment, company)}", before=before,
        after={"employment": employment, "company_name": company},
    )


def render_diff(request):
    before = request.before or {}
    return [{
        "field": "Works for", "before": _label(before.get("employment"), before.get("company_name")),
        "after": _label(request.payload.get("employment"), request.payload.get("company_name")),
    }]


def consequences(request):
    from ledger import escrow

    before = getattr(request, "before", None) or {}
    if request.payload.get("employment") == Rider.THIRD_PARTY:
        if before.get("employment") == Rider.THIRD_PARTY:
            return ["Only the rider company's name changes. The rider stays a third-party rider and nothing else changes."]
        if not escrow.enabled():
            return ["Marks this rider as a third-party rider. The wallet system is switched off, so this has no money effect "
                    "yet; once it is on, each delivery they make from approval is paid into their wallet less AshantiHub's "
                    "commission, and deliveries made before approval, or on orders paid before then, stay with payroll."]
        from ledger import settings_store

        rate = settings_store.current("rider_commission_bp") / 100
        return [
            "From approval, each delivery this rider makes is paid into their AshantiHub wallet when Support confirms the "
            f"order with the customer: the delivery fee less AshantiHub's commission ({rate:g}% now, held until the end of "
            "the day). Deliveries made before approval, and orders paid before the wallet system was switched on, stay with payroll. They can withdraw to an account in their own "
            "name once their Ghana Card is approved."
        ]
    if not escrow.enabled():
        return ["Marks this rider as AshantiHub's own rider again. The wallet system is switched off, so this has no money "
                "effect yet; their pay returns to payroll."]
    return [
        "From approval, this rider's deliveries are AshantiHub's: delivery fees stay with AshantiHub and their pay returns "
        "to payroll. Their wallet closes. This is refused while they still have money with AshantiHub, a withdrawal on its "
        "way, or a delivered order waiting for Support's call."
    ]


EMPLOYMENT_KIND = ApprovalKind(
    key=KIND, label="Change who a rider works for", pool_permission="", current_state=current_state, apply=apply,
    response_hours=48, resolve_approver=lambda request: [(ApprovalRequest.SUPER_ADMIN, None)], render_diff=render_diff,
    validate=validate, consequences=consequences, requires_sudo=True, chain_note="Super Admin only",
)
