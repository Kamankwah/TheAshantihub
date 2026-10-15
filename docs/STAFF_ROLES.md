# AshantiHub — Staff Roles, Duties & Permissions

What each staff role is for, and what the system as built lets it **see, approve and manage**.
This describes implemented behaviour, not plans.

**As of 2026-10-07**, matching `origin/main` at `57d4c65` (production). **Not yet updated for the Scout and Operations builds (phase 2, 2026-10-08 onward):** the Admin role is now Operations, and permissions such as `portfolio.manage`, `targets.manage`, `leave.record`, `fraud.manage` and `service_issues.view` are seeded in `accounts/migrations/0030`+; only `service_issues.view` is listed below. The sources of truth are
the role seeds in `backend/accounts/migrations/0002`–`0029`, the `HasRolePermission` /
`HasAnyRolePermission` gate on each view, and the dashboard nav in
`frontend/components/admin/shell/navModel.js`. If any of those change, update this file.

---

## How staff access works

- **There are nine roles, and every staffer holds exactly one:** Super Admin, Admin,
  Accountant, Marketing, Support, Scout, Delivery Manager, Dispatch and Pickup Desk.
- **A role is a bundle of permissions.** There are 32 permissions in total. A person's effective
  permissions are their role's permissions, plus any granted to them individually, minus any
  revoked from them individually. A revoke always beats a grant.
- **Only Super Admin manages staff.** That covers inviting, resending an invite, suspending,
  deactivating, reactivating, and editing a person's individual grants and revokes. Nobody can
  suspend, deactivate or change the permissions of their own account. Only a Super Admin can
  invite another Super Admin.
- **Invites.** An invite emails a link to `/staff/activate`, where the staffer sets their own
  password. The link expires after **7 days** and can be re-sent until the account is
  activated.
- **Suspend vs deactivate.** *Suspend* is temporary and takes a reason. *Deactivate* means the
  person has left. Both lock the person out **immediately**: their current session is refused on
  the next request, not just at their next login. Both can be undone.
- **The dashboard shows only the tabs a person's permissions unlock.** Every staffer gets
  Overview and the notification bell. A link or shortcut to a tab they lack sends them back to
  Overview.
- **The server enforces every permission on its own.** Hiding a tab is a convenience, not the
  security boundary. A request without the permission gets a 403.

---

## Roles at a glance

| Role | Job in one line | Dashboard tabs they see (besides Overview) |
|---|---|---|
| **Super Admin** | Owns the platform. Manages staff and gives final approval on money-related changes. | All tabs |
| **Admin** | Onboarding and trust desk: verifies businesses and moderates what they publish. | KYC Queue, Listings Moderation, Hero Approval, Events Moderation, Reviews, Users, Scout Assignments, Categories & Zones, Site Settings, Delivery Management, Contact Messages |
| **Accountant** | Money desk: escrow, dispute settlements, reports, pricing and plan proposals, credit. | Event Pricing, Subscription Plans, Escrow Ledger, Disputes, Transactions Report, Credit & Lending |
| **Marketing** | Storefront and growth: promotions, hero, events, categories, analytics. | Hero Approval, Events Moderation, Categories & Zones, Promotions, Analytics |
| **Support** | Front line: support conversations, contact form, reviews, order status, dispute intake. | Reviews, Disputes, Users (read-only), Delivery Management, Contact Messages, Messaging / Tickets |
| **Scout** | Field visits that verify a business's address and legitimacy. | Users (read-only), Field Verification |
| **Delivery Manager** | Assigns dispatch riders to paid door-to-door orders. | Delivery Coordination |
| **Dispatch** | The courier: picks orders up and delivers them. | My Deliveries |
| **Pickup Desk** | The AshantiHub office desk: hands store-pickup orders to customers and marks them collected. | None yet (API only; the Pickup Queue screen is planned) |

---

## Permission matrix

✓ = held by the role by default. Super Admin holds every permission, and a seed test asserts it.

| Area | Permission | What it unlocks | Super Admin | Admin | Accountant | Marketing | Support | Scout | Delivery Mgr | Dispatch | Pickup Desk |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Staff | `staff.manage` | Invite, suspend, deactivate and re-permission staff | ✓ | | | | | | | | |
| | `staff.view_as` | Step in: open a team member's workspace read-only (Super Admin role required too) | ✓ | | | | | | | | |
| | `roles.manage` | Change what each role can do (the role matrix); Super Admin only, never handed out | ✓ | | | | | | | | |
| | `approvals.manage_rules` | Edit approval timers and the money limit that needs a second approver; Super Admin only | ✓ | | | | | | | | |
| | `approvals.cosign` | Co-sign requests above the money limit. Held only by the external **co-signer** role (which holds nothing else); it cannot be granted to anyone else, and nothing can be granted to the co-signer | co-signer only | | | | | | | | |
| | `commission.tax_ruling` | Record the ruling on scouts' tax status; until then scout commission stays on hold. Super Admin only | ✓ | | | | | | | | |
| | `security.manage` | Security settings: 2-step rules, sign-in policy. Super Admin only | ✓ | | | | | | | | |
| | `exports.schedule` | Schedule recurring exports; Super Admin only | ✓ | | | | | | | | |
| | `announcements.send` | Send announcements to staff; Super Admin only | ✓ | | | | | | | | |
| | `system.view` | The system and jobs view; Super Admin only | ✓ | | | | | | | | |
| Onboarding | `kyc.approve` | Approve, reject or re-open business KYC; record the address decision | ✓ | ✓ | | | | | | | |
| | `scouts.assign` | Assign scouts to businesses | ✓ | ✓ | | | | | | | |
| | `scouts.verify` | Submit field reports for own assignments | ✓ | | | | | ✓ | | | |
| Moderation | `listings.moderate` | Approve, reject or re-review listings | ✓ | ✓ | | | | | | | |
| | `hero_media.approve` | Approve, reject or re-review hero media | ✓ | ✓ | | ✓ | | | | | |
| | `event.approve` | Approve, reject or re-review events; see attendees and check-in lists | ✓ | ✓ | | ✓ | | | | | |
| | `reviews.moderate` | Publish or hide reviews | ✓ | ✓ | | | ✓ | | | | |
| | `reviews.re_review` | Send a hidden review back to pending | ✓ | | | | | | | | |
| Users | `users.view` | Read customer and business-owner accounts, without payout or tax details | ✓ | ✓ | | | ✓ | ✓ | | | |
| | `users.manage` | See payout and tax details (masked); edit; suspend or unsuspend | ✓ | ✓ | | | | | | | |
| Finance | `escrow.view` | View the ticket escrow ledger | ✓ | | ✓ | | | | | | |
| | `escrow.release` | Release a held ticket early, or put a released one back on hold | ✓ | | ✓ | | | | | | |
| | `escrow.refund` | Refund a held, undelivered ticket | ✓ | | ✓ | | | | | | |
| | `disputes.flag` | See the dispute queue; flag a dispute for investigation | ✓ | | | | ✓ | | | | |
| | `disputes.resolve_financial` | See the queue; resolve, reject or reopen disputes | ✓ | | ✓ | | | | | | |
| | `transactions.report` | Platform-wide transaction list and aggregate report | ✓ | | ✓ | | | | | | |
| | `event_pricing.manage` | Propose a new event visibility-tier price | ✓ | | ✓ | | | | | | |
| | `event_pricing.approve` | Approve or reject a proposed price | ✓ | | | | | | | | |
| | `subscription_plans.manage` | Create and edit business subscription plans | ✓ | | ✓ | | | | | | |
| | `subscription_plans.approve` | Approve, reject or re-review plans | ✓ | | | | | | | | |
| | `credit.manage` | Credit scores and adjustments, lending partners, loan decisions | ✓ | | ✓ | | | | | | |
| Content | `promotions.manage` | Approve, reject or cancel promotions | ✓ | | | ✓ | | | | | |
| | `categories.manage` | Create, edit or delete categories | ✓ | | | ✓ | | | | | |
| | `zones.manage` | Create zones | ✓ | ✓ | | ✓ | | | | | |
| | `site_settings.manage` | Edit footer contact info and social links | ✓ | ✓ | | | | | | | |
| | `analytics.view` | Marketplace analytics snapshot | ✓ | | | ✓ | | | | | |
| Operations | `orders.manage_delivery` | See every customer order; update its delivery status | ✓ | ✓ | | | ✓ | | | | |
| | `delivery.manage` | See paid door-to-door orders; assign or reassign a dispatch | ✓ | | | | | | ✓ | | |
| | `delivery.dispatch` | Own deliveries: confirm pickup and delivery | ✓ | | | | | | | ✓ | |
| | `pickup.confirm` | See the store-pickup queue and mark an order collected | ✓ | | | | | | | | ✓ |
| Money | `fees.view` | Read platform-fee rules and money settings | ✓ | | ✓ | | | | | | |
| | `fees.manage` | Propose fee-rule and money-setting changes (a Super Admin's apply at once) | ✓ | | ✓ | | | | | | |
| Support | `messaging.manage` | Every support conversation; reply as AshantiHub Support | ✓ | | | | ✓ | | | | |
| | `orders.verify` | Verify a delivered or collected product order by phone; a match releases the vendor's money, a mismatch raises a dispute | ✓ | | | | ✓ | | | | |
| | `contact_messages.manage` | Contact-form submissions: mark read, resolve | ✓ | ✓ | | | ✓ | | | | |
| | `calls.view_peers` | See calls logged by teammates in the same role (Support team call log) | ✓ | | | | ✓ | | | | |
| | `orders.support_update` | Order status screen: note a delay, cancel for the customer (never Delivered) | ✓ | ✓ | | | ✓ | | | | |
| | `support.limits` | Set Support time limits, business hours and capacity | ✓ | ✓ | | | | | | | |
| | `service_issues.view` | Read-only view of support issues and deliveries across businesses (cannot reply as Support or change a delivery) | ✓ | ✓ | | | | | | | |

---

## Role by role

### Super Admin

**Duties.** Owns the platform and is the only role that manages staff. Gives the final approval on
money-related changes that the Accountant proposes. Supervises other moderators' decisions.

**Only a Super Admin can:**
- Invite staff and resend invites, including invites to other Super Admins.
- Suspend, unsuspend, deactivate and reactivate staff.
- Grant or revoke individual permissions for one staffer without changing their role. The
  editor shows which permissions come from the role, which were granted individually, and which
  were revoked.
- Approve or reject an **event pricing** change the Accountant proposed. The live price
  doesn't change until a Super Admin approves it.
- Approve, reject or re-review **subscription plans**. This includes any edit to a plan that is
  already live, because an edit sends the plan back to pending.
- **Re-review a hidden review**, which reverses another moderator's rejection.
- **Step in** (`staff.view_as`): open an Operations, Scout, Support, Delivery Manager, Marketing or
  Accountant workspace exactly as that person sees it, read-only. The Super Admin stays signed in
  as themselves; the server substitutes the person for reads only (`X-View-As`, after a recorded
  start on the Super Admin's own 2-step session) and refuses every write and export with
  `403 view_only`. The start, the end and each screen opened are in the activity log, on behalf of
  the person viewed. Never another Super Admin, a co-signer or a rider; granting the code to anyone
  else does nothing (`accounts/view_as.py`).

Super Admins can also do everything listed for every other role below.

### Admin

**Duties.** Runs the onboarding and trust desk. Admins verify that businesses are real, moderate
what businesses publish, keep user accounts in order, send scouts into the field, and keep the
site's public contact details current.

**Approves / rejects**
- **KYC (business verification).** Approve, reject with a reason, or re-open a rejected
  submission. The business is notified in each case. Before approving, the Admin records a
  decision on the business's Ghana Post address, either verified or not verified. The KYC
  Approve and Reject buttons stay locked until that decision exists. The decision can come from
  the Admin's own desk toggle or from a scout's field visit.
- **Listings.** Approve a listing, but only when its business is already KYC-verified. Reject
  with a reason, or re-review a rejected listing.
- **Hero media.** Approve, reject or re-review.
- **Events.** Approve, reject or re-review.
- **Reviews.** Publish a pending review. Hide a review with a reason, either to reject it while
  pending or to take it down after it was published. Admins **cannot** bring back a hidden
  review; only a Super Admin can.

**Manages**
- **Users.** Full detail on customers and business owners, including payout and tax (TIN)
  details, which are always masked. Admins can edit identity fields and suspend or unsuspend an
  account; the account holder is notified.
- **Scout assignments.** Assign an active scout to a business and see every assignment.
- **Zones.** Create zones. Admins do **not** hold `categories.manage`, so on the Categories &
  Zones tab only the zones side is theirs.
- **Site settings.** Footer contact info and social links.
- **Delivery Management.** See every customer order and move its delivery status through
  processing, shipped, out for delivery and delivered. The customer is notified at each change.
- **Contact messages.** Mark submissions read and resolve them.

**Cannot.** Manage staff, see Analytics, touch anything financial (escrow, disputes,
transactions, credit, pricing, plans), manage promotions, or answer support conversations.

### Accountant

**Duties.** Runs the money desk. Accountants handle the ticket escrow, settle the financial side
of disputes, report on transactions, propose prices and plans for Super Admin approval, and run
credit and lending.

**Decides**
- **Disputes.** Resolve a dispute, optionally recording a refund amount and notes, or reject it.
  A resolved dispute is final. A rejected dispute can be reopened, which returns it to Pending,
  in case it was rejected by mistake.
- **Loan applications.** Mark an application approved, declined or under review. Approved and
  declined are final.

**Manages**
- **Escrow ledger.** Ticket payments are held until check-in. Accountants can view the ledger;
  release a held ticket early, with a note and the password; put a released ticket back on hold, for example when
  a dispute arrives after release; and refund a held, undelivered ticket, which books a
  negative-amount transaction. **Refund belongs only to Accountant and Super Admin.**
- **Transactions report.** Every customer and business transaction across the platform, with
  date filters, totals, a breakdown by status and a monthly series.
- **Event pricing.** Propose a new price for a visibility tier. The proposal waits for Super
  Admin approval.
- **Subscription plans.** Create and edit plans. Every new plan, and every edit to a live plan,
  goes to Super Admin as *pending approval*.
- **Credit & lending.** See every business's credit score. Apply a manual adjustment, which is a
  signed change on top of the computed score and requires a reason. Add, edit, deactivate or
  reactivate lending partners. Partners can't be deleted, which keeps loan history intact.

**Cannot.** Approve their own pricing proposals or plans, moderate anything (KYC, listings,
events, reviews), or see user accounts.

**The Accounting dashboard (31 screens, built 2026-10-13).** The menu is the approved canvas:
Decisions, Ledger, Money in, Money out, People, Tax, Controls, Plans & pricing and Reports, with the
Money desk as the Overview. Disputes, Transactions Report, Commission policy, Tasks, Activity and
Sign-in & Security stay reachable under "More tools".

- **Real screens:** Money desk, Collections (every incoming payment with our and the provider's
  reference), Escrow, Refunds, Commissions, Audit chain, Alerts, Subscription plans, Event pricing,
  Credit & lending, Statements (revenue by type, before tax) and My reports. All read existing
  records. Money screens need `transactions.report` (Commissions needs `commission.view_all`); no new
  permission was added.
- **Honest shells (14 screens):** Journal, Chart of accounts, Trial balance, Payout runs, Seller
  settlements, Rider payouts, Payroll, Pay profiles, PAYE, SSNIT & Tier 2, Withholding tax, VAT/NHIL/
  GETFund, Tax settings and Period close (Reconciliation is Super Admin's existing shell). AshantiHub
  has no ledger, journal, payout, payroll, pay-profile, tax or period record, and none is invented: each
  screen says it arrives with the Accounting phase and names what it cannot show. No tax is calculated.
  The canvas's detail and form screens (journal entry, new entry, payout run detail, payslip) are not
  built: they reach nothing.
- **Escrow is tickets only.** Orders, bookings and delivery have no escrow record. The screen says so.
- **Password again (sudo)** on ticket escrow release and
  refund, on resolving a dispute (it can refund), and on a Collections export (it names payers). Every escrow action needs a note (3 to 500 characters).
- **No refund request or approval limit exists.** An Accountant decides a dispute's refund, or a
  ticket's refund, directly; the GH₵ 500 / 20,000 ladder on the canvas is not enforced.
- **Alerts** are worked out on read: a refund over 3 times the 90-day average, a business refunded 3 or
  more times in 30 days, and open fraud cases (information only). Resolving takes a note and is written
  to the activity log. Rules that need a ledger, payout or reconciliation record are listed as not
  available.
- **Audit chain** is the staff activity chain (the nightly check's stored result). There is no ledger
  chain. "Verify now" is not offered.
- **Not built:** "Reverse with reason" and "Prepare batch" on Commissions (no reversal or batch API),
  money-alert badge on the menu (it would add a heavy poll).

### Marketing

**Duties.** Runs the storefront and growth: what gets promoted, what appears in the hero, which
events go live, how the catalogue is categorised and zoned, and how the marketplace is doing.

**Approves / rejects**
- **Promotions.** Approve a pending promotion, which starts its run window. Reject one with a
  reason. Cancel an active one; cancelling is **not** a refund, and the UI says so before
  confirming.
- **Hero media.** Approve, reject or re-review.
- **Events.** Approve, reject or re-review.

**Manages**
- **Categories.** Create, edit and delete. A delete is refused while any listing still uses the
  category.
- **Zones.** Create zones.
- **Analytics.** A live snapshot of real counts across accounts, listings, orders and events.

**Cannot.** Approve KYC or listings, moderate reviews, see users, touch finance, or edit site
settings.

### Support

**Duties.** The front line. Support answers every conversation with AshantiHub Support, works
the public contact form, moderates reviews, keeps order delivery statuses current, and takes in
disputes.

- **Messaging / Tickets.** Every support conversation, with a needs-reply flag. Replies go out
  as AshantiHub Support (`sender_type = staff`). Per the product rules, a customer never talks
  to a business directly.
- **Contact messages.** Mark submissions read and resolve them.
- **Reviews.** Publish or hide, the same as Admin. Support cannot bring back a hidden review.
- **Disputes, intake only.** See the queue and *flag* a dispute, which moves it to
  investigating. Support **cannot** resolve or reject a dispute; that is the Accountant's job.
- **Users, read-only.** Customer and business-owner accounts, without payout or tax details.
  Support can't edit or suspend anyone.
- **Delivery Management (removed from Support).** Support no longer holds
  `orders.manage_delivery`: it could mark an order Delivered, which only the rider's code (or a
  delivery manager) may do. Support uses the narrow Order status screen (`orders.support_update`).
- **The Support desk (canvas, 2026-10-07).** Conversations carry an assignee, priority, snooze,
  resolution, tags, first-reply and resolve time limits (set by Operations with `support.limits`),
  and *internal notes*. **Internal notes and timeline events are staff-only**: every customer,
  owner and guest serializer excludes them (contract: `messaging/tests/test_note_leak.py`).
  A conversation is always with AshantiHub Support about a business, listing or order
  (`about_*`); nothing contacts a business directly.

### Scout

**Duties.** Visits businesses in person to confirm that the Ghana Post address is correct, that
the business is legitimate, and that the owner's details match.

- **Field Verification.** Shows only the scout's own assignments. For each visit the scout
  submits a report with these fields:
  - whether the address was correct (required)
  - a corrected address
  - whether the business is legitimate
  - whether the owner's details are correct
  - notes
- **Submitting a report records the address decision on the business's profile.** That is the
  same field that unlocks the Admin's KYC Approve and Reject buttons, so a scout's visit counts
  the same as the desk toggle. If the scout marks the address wrong and supplies a correction,
  the business's address is replaced with it.
- **Users, read-only.** So the scout can see who and what they are verifying.

**Cannot.** Approve KYC, pick their own assignments (an Admin assigns them), or report on
another scout's assignment.

### Delivery Manager

**Duties.** Coordinates door-to-door delivery.

- **Delivery Coordination.** Shows paid door-to-door orders; store-pickup orders are excluded
  because customers collect them. The Delivery Manager assigns an active dispatch rider to an
  order, and assigning again just swaps the rider.

### Dispatch

**Duties.** The courier.

- **My Deliveries.** Shows only the rider's own assigned deliveries, with pickup and drop-off
  locations. The rider confirms **pickup** (assigned → picked up) and then **delivery**
  (picked up → delivered). Each step also updates the order's delivery status. The customer then
  confirms receipt separately.

### Pickup Desk

**Duties.** The AshantiHub office desk. Holds only `pickup.confirm`: it hands paid store-pickup
orders to customers and marks them collected. Collecting also marks the order delivered, which
starts Support's verification. The desk never sees a customer's phone number. Only a Super Admin
invites it. The Pickup Queue dashboard tab is planned; today the desk works through the API only.

---

## Separation of duties

These rules keep one person from both proposing and approving the same thing.

| Action | Who proposes / does the first step | Who approves / does the second step |
|---|---|---|
| Event visibility price change | Accountant proposes | Super Admin approves or rejects |
| Subscription plan (new or edited) | Accountant authors | Super Admin approves, rejects or re-reviews |
| Review moderation | Admin or Support publishes or hides | Only Super Admin can reverse a hide |
| Dispute | Support flags it (intake) | Accountant resolves or rejects it, and can reopen a wrong rejection |
| Ticket refund | (Escrow view and release are Accountant duties) | Refund is Accountant + Super Admin only |
| Field verification | Admin assigns a scout | The scout reports; the Admin then approves or rejects KYC |
| Platform-fee rules and money settings | Accountant proposes | Super Admin approves or rejects |
| Releasing an order's money | Pickup Desk or the rider marks it collected/delivered | Support records the verification call that releases it |
| Delivery | Delivery Manager assigns | Dispatch picks up and delivers; the customer confirms receipt |
| Staff accounts and permissions | — | Super Admin only, never on their own account |

**Large approvals and the co-signer.** A request above the money limit needs a second approval from the
external co-signer. This constrains staged requests made by others only: a Super Admin's own request
applies at once whatever the amount (the canvas rule: "a Super Admin's own changes apply at once and are
recorded"), and is recorded as applied directly. No approval kind defines `amount_of` yet, so the limit
is dormant until one does. Separately, the permissions marked Super Admin only above cannot be granted
to a role or to a person by anyone else.

---

## How the roles hand work to each other

1. **Business onboarding.** A business registers and its KYC is pending, so Admins get an
   alert. Next comes the address decision: either an Admin decides at the desk, or an Admin
   assigns a scout and the scout's report records it. Then an Admin approves or rejects the
   KYC. Once the business is KYC-verified it can submit listings, and an Admin moderates them.
2. **Door-to-door order.** The customer pays. The Delivery Manager assigns a dispatch rider,
   the rider confirms pickup and then delivery, and the customer confirms receipt. Separately,
   Admin and Support can update any order's delivery status from Delivery Management.
3. **Events.** An organizer submits an event. Admin or Marketing approves it, and the organizer
   then pays for visibility. The Accountant proposes tier prices and the Super Admin approves
   them. Ticket money sits in escrow until check-in, and the Accountant handles exceptions:
   early release, re-hold and refund.
4. **Dispute.** A customer raises a dispute against an order. Support flags it, which moves it
   to investigating. The Accountant then resolves or rejects it, and can reopen a wrong
   rejection.
5. **Subscription plans.** The Accountant authors a plan, the Super Admin approves it, and only
   then can businesses see it.

---

## Alerts and tab badges

Staff get a bell notification when new work lands, sent to every staffer whose role holds the
matching permission:

| New work | Permission that receives it | Roles alerted by default |
|---|---|---|
| KYC submitted or re-opened | `kyc.approve` | Super Admin, Admin |
| Listing awaiting moderation | `listings.moderate` | Super Admin, Admin |
| Hero media awaiting approval | `hero_media.approve` | Super Admin, Admin, Marketing |
| Event awaiting approval | `event.approve` | Super Admin, Admin, Marketing |
| Review awaiting moderation | `reviews.moderate` | Super Admin, Admin, Support |
| New support message | `messaging.manage` | Super Admin, Support |
| New contact-form message | `contact_messages.manage` | Super Admin, Admin, Support |

Tab badges count work that is still open, not unread alerts. They refresh every 60 seconds and
appear on these tabs: KYC Queue, Listings Moderation, Hero Approval, Events Moderation, Reviews,
Plan Approvals, Contact Messages and Escrow Ledger.

---

## Editing a whole role (Super Admin build, SA-4)

Until this build a role's permissions were fixed by migration seeds; only one person's grants and
revokes could be edited. **Roles & permissions** (Super Admin, `roles.manage`) now edits a role:

- Tick or untick a permission for a role. **Review and save** shows, per change, who it reaches and
  which individual grants or revokes it touches; nothing is saved until you re-enter your password.
- A save takes effect at once (the effective set is read on every request) and reconnects the
  people affected. One `role.permissions_changed` audit event holds the before and after for every
  box that changed.
- **Guards, enforced on save:** the Super Admin role is locked (it always holds every permission, as
  the seed test asserts). `roles.manage`, `approvals.manage_rules`, `staff.view_as` and `staff.manage`
  cannot be handed to another role. `approvals.cosign` belongs to the Co-signer role alone and that
  role holds nothing else, so whoever makes a request can never also co-sign it.
- Only permissions that exist are listed. The canvas codes `payouts.prepare`, `payouts.approve`,
  `campaigns.send` and `customers.export` are not created yet; each appears here when its phase adds it.

The directory, profile, org chart, invites and sessions screens read `/api/people/`. A manager change
(`staff.manager_changed`) and a role change (`staff.role_changed`) each ask for the password, need a
reason and record before and after. A person's pay profile, payslips and payout account do not exist
in the data, so the profile shows commission only and says pay arrives with the Accounting phase.

---

## Known gaps (found while compiling this)

1. **Three places check only the role's permissions and ignore individual grants and
   revokes.** `backend/CLAUDE.md` says every permission check must read the effective set, but
   these don't:
   - `backend/events/permissions.py:59`: staff access to event attendee lists, check-in lists and
     ticket check-in checks the **role's** `event.approve` only.
   - `backend/notifications/views.py:107`: tab badge counts.
   - `backend/notifications/services.py:60` (`notify_staff_role`): bell alerts. This one also
     doesn't skip suspended or deactivated staff.

   As a result, someone given a permission individually gets the tab and can act in it, but sees
   no badge and gets no alerts. Someone who had a permission revoked still gets the alerts and
   badge counts, even though the server refuses the action.
2. **Staff ticket check-in has no dashboard screen.** The API lets `event.approve` staff view
   check-in lists and check tickets in, but only event organizers can reach the QR scanner, from
   their own events panel.
3. **A dispute's "refund amount" is only recorded.** Resolving a dispute stores the amount but
   books no refund transaction; only the escrow refund books one. More broadly, payments are
   **simulated** (`MoMoPayment`) until the Hubtel integration lands
   (`docs/HUBTEL_INTEGRATION.md`), so no real money moves in any of these flows yet.
4. **Marketing's `analytics.view` also opens the staff credit-score list API**, which was its
   original gate. There is no tab for it; the Credit & Lending tab needs `credit.manage`.
