# Businesses choose several categories — design

Date: 2026-10-29. Status: draft for the owner's approval.

## Why

A general merchant sells products from many categories in one store, and Ghana's market changes, so a
business's mix changes with it. Today a business can name only one category (and a self-registering owner
is never asked for one). Registration should let a business say everything it does, and let it change that
later without friction.

## What the owner decided

- During registration a business chooses **one or more categories** for the kind it picked (products or
  services). Owners and scouts both can.
- The categories **describe** the business; they do not limit it. A business can list in a category it did
  not pick, if it needs to. Business kind (products or services) is still what limits listings.
- A business can **change its categories later**, as market conditions change.

## Today (what the code does)

- `BusinessOwnerProfile.business_category` is a single nullable FK to `listings.Category`. It is written
  only by the **scout** registration (`portfolio/registration.py`, one dropdown in `RegisterBusinessPanel.jsx`,
  validated so the category's `kind` equals the business kind in `portfolio/serializers.py`).
- A **self-registering owner is never asked** for a category. They pick only `business_kind` once, at the
  plan step (`billing.StartTrialSerializer` when subscriptions are on, `billing.BusinessKindView` when off;
  `BusinessRegistrationFlow.jsx`). `business_kind` is set once and cannot be changed.
- Listings are limited by kind, not by the business's category: `listings/serializers.py` refuses a
  category whose `kind` differs from `profile.business_kind` and nothing else.
- Readers of `business_category`: staff screens (KYC queue and review, Super Admin business detail,
  business page, portfolio rows), `marketing/audience.py` (`profile__business_category_id__in`),
  `insights/sales.py` (zone and category of a payment).

## Design

### 1. Data
- A business has an ordered list of categories. Order matters only for **the main category**, the first.
- `business_category` stays as the main category, kept in sync, so every existing reader and report keeps
  working unchanged. A new link table holds the full ordered list.
- One writer: a single function (for example `profile.set_categories(category_ids)`) validates and saves
  the list and the main category together, inside one transaction. Nothing else writes either.
- Validation: at least 1 and at most 10 categories *(owner's guess to confirm)*; no duplicates; every
  category must have `kind` equal to the profile's `business_kind` (stays and events are not categories a
  business registers under); a category that does not exist or is a department parent is refused with a
  plain message.
- Migration: every business that has `business_category` gets a list of one. Businesses with none get an
  empty list (their staff screens say "Not given", as today).

### 2. Owner registration
- At the step where the owner picks products or services, once a kind is chosen, category chips for that
  kind appear and the owner chooses one or more. The kind step cannot be continued with none.
- The category list is saved **together with the kind**, in the same request/transaction, in both the
  subscriptions-on path (`start-trial`) and the subscriptions-off path (`business-kind`). A retry after a
  failure must not leave a business with a kind and no categories, nor block the owner.
- The requirement applies **only where the kind is first set**. `compute_registration_step` does not start
  asking existing owners for categories: a business already past registration is never sent back.
- A scout-registered business already has a kind (and categories from the scout), so its owner is not asked.

### 3. Scout registration
- The single category dropdown becomes multi-select chips for the chosen kind; the first pick is the main
  category. Changing the kind clears the picks (as the dropdown does today). The draft stores the list.
- The server accepts a list (`business_categories`); `business_category` as a single value from an older
  client still works (a list of one).

### 4. Changing categories later
- A new "Your categories" section on the business dashboard profile lets the owner add, remove and reorder
  (to change the main one). It saves through one owner endpoint that calls `set_categories`.
- Allowed at any time, including after KYC approval and with listings live. It does **not** touch KYC,
  identity, subscription or any listing. A scout's account-manager assignment is unaffected.
- A business can never end with zero categories through the editor *(owner's guess: at least 1)*; an
  existing business with none may add some.

### 5. Readers
- Staff screens that show a business's category show all of them, main first (`business_category_name`
  stays the main one for compatibility; a new list field carries the rest).
- Marketing audience filtering by category matches a business that has **any** of the chosen categories
  (still excluding duplicates).
- `insights/sales.py` keeps using the main category. Documented as a deliberate simplification.

## Goals
- A general merchant picks several categories at registration, as an owner or through a scout.
- A business can change its categories whenever its trade changes.
- Existing screens, reports and businesses keep working, with no re-registration.

## Non-goals
- Restricting listings to the chosen categories, or auto-creating categories.
- Letting one business mix product and service kinds (kind stays single, chosen once).
- Reworking category structure (the department tree) or the shopper-facing category pages.
- Per-category analytics for businesses.

## Anti-goals
- A business blocked from listing because it did not tick a category.
- An existing owner dragged back into registration because they have no categories.
- A business ending with a main category that is not in its list, or the other way round.
- Staff screens or reports that break for a business with several, or none.

## Constraints
- Follow `backend/CLAUDE.md` and `frontend/CLAUDE.md` (no `useMutation`, inline palettes, dark-mode tokens,
  `components/**` never imports `App.jsx`), `DESIGN.md`, and the "no fabricated data" rule (an empty list
  reads "Not given").
- Tests first. Staging only; production waits for the owner's word (`deploy` skill).
- Update `backend/CLAUDE.md` for the new single writer and the main-category rule.

## Calls made without the owner (confirm or change)
1. At least 1 and at most 10 categories.
2. The first category is the main one; `business_category` stays as the main, kept in sync.
3. Insights keep using the main category only.
4. Category chips for owners sit at the existing kind/plan step, not in the business details step (the kind
   is not known earlier).

## Left to the builder
Names of the link table, fields and endpoints; how the kind and categories are saved together on each
billing path; the chip and editor layout; migration and test structure.
