# Businesses choose several categories — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A business (self-registered or scout-registered) chooses one or more categories of its kind at registration and can change them later; the categories describe the business and never restrict listings.

**Architecture:** A new ordered link table (`BusinessOwnerCategory`) holds the list; `BusinessOwnerProfile.business_category` stays as the main (first) category, kept in sync by one writer, `accounts.categories.set_categories`, so every existing reader keeps working. Owners pick categories at the existing product/service step, saved atomically with the kind; scouts get a multi-select; an owner endpoint and a dashboard card edit the list later.

**Tech Stack:** Django/DRF + Postgres (tests: `docker compose run --rm web python manage.py test <label>`; on this machine host port 5432 is busy, so use the compose override the controller supplies), React/Vite + Vitest (run from `frontend/`).

**Spec:** `docs/superpowers/specs/2026-10-29-business-multiple-categories-design.md`

## Global Constraints

- At least 1 and at most 10 categories; no duplicates; every category's `kind` equals the profile's `business_kind` (product or service). `Category.kind` "event" is never valid for a business.
- The first category is the main one; `business_category` always equals the first link (or is NULL when the list is empty); only `set_categories` writes either.
- Categories describe, never restrict: nothing in `listings/` changes (listings stay limited by `business_kind` only).
- The requirement of ≥1 category applies **only where the kind is first set** (`billing/start-trial`, `billing/business-kind`). `compute_registration_step` must not change: a business already past registration is never sent back.
- Changing categories never touches KYC, identity, subscription or listings.
- An empty list shows "Not given" on staff screens (no placeholders). Existing `business_category` consumers keep working: `insights/sales.py` keeps the main category.
- Follow `backend/CLAUDE.md` and `frontend/CLAUDE.md` (no `useMutation`, inline `C`/`D` palettes, dark-mode tokens, `components/**` never imports `App.jsx`), `DESIGN.md`. Tests first. Staging only; production waits for the user (`deploy` skill).
- Commit trailers on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_014z841QypeCF6wWb7h1WSRr`.

## Review Focus

1. An existing, fully registered owner with no categories keeps their dashboard and step (`registration_step` stays `complete`); nothing re-asks them.
2. Sending a kind with invalid categories (none, 11, duplicates, wrong kind, unknown id) answers 400 and the kind is **not** set, so the owner can retry from the same screen.
3. Main category and list never disagree (reorder, remove the main, delete a `Category` that is linked).
4. A business with several categories shows once (no duplicate rows) in staff lists and the marketing audience, with no per-row queries.
5. Scout form: changing the kind clears the picks; an old saved draft with a single `business_category` loads; the main category is the first pick.
6. The dashboard editor for a business whose kind is not set yet gives a plain message instead of an error screen; it cannot be emptied.

(Tests: 1 → Task 3, 2 → Tasks 1 and 3, 3 → Task 1, 4 → Task 5, 5 → Task 8, 6 → Tasks 2 and 9.)

---

### Task 1: Link table, single writer, migration

**Files:**
- Modify: `backend/accounts/models.py` (new `BusinessOwnerCategory`)
- Create: `backend/accounts/categories.py`, `backend/accounts/migrations/0069_business_categories.py` (use the next free number)
- Test: `backend/accounts/tests/test_business_categories.py`

**Interfaces:**
- Produces: model `BusinessOwnerCategory(profile FK BusinessOwnerProfile related_name="category_links", category FK listings.Category on_delete=CASCADE related_name="+", position PositiveSmallIntegerField)`, ordering by `position`, unique `(profile, category)` and `(profile, position)`.
- Produces in `accounts/categories.py`: constants `MIN_CATEGORIES = 1`, `MAX_CATEGORIES = 10`; `class InvalidCategories(Exception)` with `.message`; `set_categories(profile, category_ids) -> list[Category]` (inside `transaction.atomic`, locks the profile row `select_for_update(of=("self",))`, validates, replaces the links, sets `profile.business_category` to the first, saves `update_fields=["business_category"]`, returns the ordered categories); `categories_of(profile) -> list[Category]` (ordered; falls back to `[business_category]` when there are no links and a main exists).
- Produces: migration function `backfill_categories(apps, schema_editor)`.
- Messages (exact): "Choose at least one category.", "Choose at most 10 categories.", "Pick each category once.", "Choose products or services first.", "Choose categories for a {kind} business." (kind word `product`/`service`), "That category doesn't exist."

- [ ] **Step 1: Write failing tests** in `test_business_categories.py`: `test_set_categories_saves_ordered_list_and_main`, `test_main_is_the_first_pick_after_reordering`, `test_removing_the_main_promotes_the_next`, `test_rejects_empty_list_and_eleven`, `test_rejects_duplicates`, `test_rejects_wrong_kind_and_event_categories`, `test_rejects_unknown_id`, `test_requires_a_business_kind`, `test_failed_call_changes_nothing` (list and main untouched), `test_deleting_a_linked_category_leaves_a_consistent_list` (after delete, `categories_of` has no hole and `business_category` is the first remaining link or NULL — resync in the writer or a `post_delete` handler), `test_backfill_gives_a_list_of_one_and_leaves_empty_for_none` (load `backfill_categories` via `importlib.import_module("accounts.migrations.0069_business_categories")`).
- [ ] **Step 2: Run** `... test accounts.tests.test_business_categories` — expect FAIL.
- [ ] **Step 3: Implement the model, `categories.py` and the schema + `RunPython(backfill_categories, noop)` migration** (backfill uses `apps.get_model`; one link per profile with a `business_category`, position 0). Generate the schema part with `makemigrations accounts -n business_categories`.
- [ ] **Step 4: Run** the module and `makemigrations --check --dry-run` — expect PASS / no changes.
- [ ] **Step 5: Commit** `feat(accounts): businesses keep an ordered list of categories`.

### Task 2: Owner endpoint to read and change categories

**Files:**
- Modify: `backend/accounts/views.py`, `backend/accounts/urls.py`
- Test: `backend/accounts/tests/test_business_categories_api.py`

**Interfaces:**
- Consumes: Task 1 `set_categories`, `categories_of`, `InvalidCategories`.
- Produces: `GET`/`PUT /api/accounts/business-owners/me/categories/` (`IsBusinessOwner`, name `business-owner-categories`). `GET` and the `PUT` response: `{"business_kind": str|null, "min": 1, "max": 10, "categories": [{"id", "label", "kind"}]}`. `PUT` body `{"categories": [ids]}`; `InvalidCategories` → 400 `{"detail": message}`.

- [ ] **Step 1: Write failing tests**: `test_get_returns_kind_limits_and_ordered_categories`, `test_put_replaces_the_list_and_the_main`, `test_put_works_after_kyc_is_verified_and_with_live_listings`, `test_put_does_not_touch_kyc_identity_or_subscription`, `test_put_cannot_empty_the_list`, `test_put_without_a_kind_says_choose_products_or_services_first`, `test_invalid_ids_answer_400_with_plain_detail`, `test_customer_and_staff_get_403`, `test_unauthenticated_is_401`.
- [ ] **Step 2: Run** the module — FAIL.
- [ ] **Step 3: Implement `BusinessOwnerCategoriesView`** (APIView; lock order: the view locks only the profile row via `set_categories`, never the owner row).
- [ ] **Step 4: Run** the module and `accounts` label — PASS.
- [ ] **Step 5: Commit** `feat(accounts): owners change their categories from the dashboard`.

### Task 3: Save categories together with the kind

**Files:**
- Modify: `backend/billing/serializers.py` (`StartTrialSerializer`), `backend/billing/views.py` (`BusinessKindView`)
- Test: `backend/billing/tests/test_start_trial_categories.py`, update `test_start_trial.py` / `test_start_trial_kind.py` / business-kind tests whose request bodies now need `categories`

**Interfaces:**
- Consumes: Task 1 `set_categories`.
- Produces: both endpoints accept `categories: [ids]`. **When this call sets the kind** (profile has no `business_kind`), `categories` is required and the kind, the categories and (start-trial) the subscription are saved in one `transaction.atomic`; any `InvalidCategories` → 400 `{"categories": [message]}` and the kind stays unset. **When the kind is already set** (scout-registered), `categories` is not required and is ignored.

- [ ] **Step 1: Write failing tests**: `test_start_trial_sets_kind_categories_and_subscription_together`, `test_business_kind_endpoint_sets_kind_and_categories_together`, `test_missing_categories_400_and_kind_stays_unset` (both endpoints), `test_eleven_duplicates_wrong_kind_unknown_400_and_kind_stays_unset`, `test_retry_after_failure_succeeds`, `test_scout_registered_owner_with_kind_set_needs_no_categories`, `test_registration_step_unchanged_for_a_complete_owner_without_categories` (owner with kind, plan, payout, terms and no categories → `compute_registration_step() == "complete"`), `test_conditional_update_race_still_sets_kind_once` (second call 400 "already set", categories not changed).
- [ ] **Step 2: Run** `billing` label — expect new tests to FAIL and old request bodies to need updating.
- [ ] **Step 3: Implement** in both places; wrap kind update + `set_categories` (+ subscription) in one transaction; update existing test bodies to include `categories`.
- [ ] **Step 4: Run** `billing` and `accounts` labels — PASS.
- [ ] **Step 5: Commit** `feat(billing): the kind and the categories are chosen together`.

### Task 4: Scout registration takes several categories

**Files:**
- Modify: `backend/portfolio/serializers.py` (`ScoutRegistrationSerializer`), `backend/portfolio/registration.py`
- Test: `backend/portfolio/tests/test_registration.py`

**Interfaces:**
- Consumes: Task 1 `set_categories`.
- Produces: the registration accepts `business_categories` (JSON array of ids; in multipart a JSON array string, parsed like `hours` in `registration.py`; also accepted as a real JSON array) and still accepts the old single `business_category` (a list of one). Exactly one of the two is needed; at least 1, at most 10; every category's kind equals `business_kind` (message "Choose a category for this kind of business."). The profile is created and `set_categories` run inside the existing registration transaction; `business_category` is the first.

- [ ] **Step 1: Write failing tests**: `test_scout_registers_with_several_categories_main_is_first`, `test_single_business_category_still_works`, `test_multipart_json_string_list_is_parsed`, `test_no_category_is_400`, `test_eleven_duplicate_and_wrong_kind_are_400`, `test_a_failed_registration_creates_no_owner`, `test_duplicate_business_check_unaffected`.
- [ ] **Step 2: Run** `portfolio.tests.test_registration` — FAIL.
- [ ] **Step 3: Implement** the serializer field + parse step and the `set_categories` call.
- [ ] **Step 4: Run** `portfolio` and `field` labels — PASS.
- [ ] **Step 5: Commit** `feat(portfolio): scouts register a business under several categories`.

### Task 5: Staff readers show all categories; audience matches any

**Files:**
- Modify: `backend/portfolio/serializers.py` (the two `business_category` payloads ~lines 278 and 394), `backend/accounts/serializers.py` (KYC detail ~485), `backend/accounts/kyc.py` (`with_review_data` prefetch), `backend/portfolio/views.py` (select/prefetch ~429, ~527), `backend/marketing/audience.py` (~89)
- Test: `backend/portfolio/tests/test_portfolio_api.py` (or the module testing those payloads), `backend/accounts/tests/test_kyc_detail.py`, `backend/marketing/tests/test_audience.py`

**Interfaces:**
- Consumes: Task 1 `categories_of`, link model.
- Produces: portfolio payloads keep `business_category` / `category` (main, `{id, name}`) and add `business_categories` / `categories` (list of `{id, name}`, main first, `[]` when none); KYC detail keeps `business_category_name` and adds `business_category_names` (list of labels); audience `categories` filter matches **any** link (`Exists`, no duplicate owners).

- [ ] **Step 1: Write failing tests**: `test_portfolio_business_shows_all_categories_main_first`, `test_kyc_detail_lists_every_category_name`, `test_business_with_no_categories_gets_an_empty_list`, `test_audience_matches_a_business_on_any_of_its_categories_once`, `test_audience_count_unchanged_for_single_category_businesses`, `test_list_endpoints_do_not_query_per_business` (query count for 1 vs 5 businesses).
- [ ] **Step 2: Run** the three modules — FAIL.
- [ ] **Step 3: Implement** with `prefetch_related("profile__category_links__category")` wherever lists are built.
- [ ] **Step 4: Run** `portfolio`, `accounts`, `marketing` labels — PASS.
- [ ] **Step 5: Commit** `feat: staff screens and audiences see every category a business has`.

### Task 6: Category chips component and hook

**Files:**
- Create: `frontend/components/CategoryChips.jsx`, `frontend/hooks/useMyCategories.js`
- Test: `frontend/components/__tests__/CategoryChips.test.jsx`, `frontend/hooks/useMyCategories.test.js` (follow existing hook-test style), MSW handlers in `frontend/mocks/handlers.js`

**Interfaces:**
- Produces: `CategoryChips({ categories, value, onChange, max = 10, disabled, label })` — `categories: [{id,label,icon?}]`, `value: number[]` (ordered; first is the main, shown with a "Main" tag), `onChange(nextIds)`; clicking selects/deselects; selecting beyond `max` is ignored with a hint "You can choose up to 10"; each chip is a toggle button with `aria-pressed`; token-only colors.
- Produces: `useMyCategories(enabled = true)` — react-query key `['my-categories']`, GET `/api/accounts/business-owners/me/categories/`.

- [ ] **Step 1: Write failing tests**: `CategoryChips toggles a category on and off`, `the first selected shows the Main tag and removing it promotes the next`, `stops at max and shows the hint`, `exposes aria-pressed and is keyboard operable`, `renders nothing selectable when disabled`, `useMyCategories reads the endpoint`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run components/__tests__/CategoryChips.test.jsx` — FAIL.
- [ ] **Step 3: Implement** the component (inline `C`/`D` tokens passed via prop `palette` or the public `C` default; `components/**` must not import `App.jsx`) and the hook; add MSW GET/PUT defaults.
- [ ] **Step 4: Run** the new tests and `__tests__/darkModeLiterals.test.js __tests__/theme.test.jsx` — PASS.
- [ ] **Step 5: Commit** `feat(frontend): multi-select category chips`.

### Task 7: Owner registration chooses categories with the kind

**Files:**
- Modify: `frontend/components/BusinessRegistrationFlow.jsx` (both `plan_selection` forms and `handlePlanSelectionSubmit`, `handleBusinessKindSubmit`), `frontend/hooks/useAuth.js` (`submitPlanSelection` passes `categories`)
- Test: `frontend/BusinessRegistrationFlow.test.jsx`

**Interfaces:**
- Consumes: Task 6 `CategoryChips`, `useRegistrationOptions(kind)` (existing hook: categories of the chosen kind), Task 3 payloads (`categories: number[]`).

- [ ] **Step 1: Write failing tests**: `choosing a kind shows category chips for that kind only`, `changing the kind clears the picks`, `continue is disabled until at least one category is chosen`, `start-trial posts business_kind plan cycle_months and categories in order`, `business-kind posts business_kind and categories`, `a 400 from the server shows its message and keeps the picks`, `a scout-registered owner whose kind is already set is not asked for categories`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run BusinessRegistrationFlow.test.jsx` — FAIL.
- [ ] **Step 3: Implement** the chips under the kind buttons (copy: "What do you sell or do? Choose all that apply. You can change this later."), state reset on kind change, payloads with `categories`.
- [ ] **Step 4: Run** the file and `__tests__/darkModeLiterals.test.js __tests__/theme.test.jsx` — PASS.
- [ ] **Step 5: Commit** `feat(frontend): owners choose their categories when they pick a kind`.

### Task 8: Scout form multi-select

**Files:**
- Modify: `frontend/components/admin/panels/RegisterBusinessPanel.jsx` (`business_category` state, validation ~line 327, FormData ~388, summary ~259, draft restore)
- Test: `frontend/components/admin/panels/__tests__/RegisterBusinessPanel.test.jsx`, `RegisterFromProspect.test.jsx`

**Interfaces:**
- Consumes: Task 6 `CategoryChips`, `useRegistrationOptions`, Task 4 wire format (`business_categories` JSON array string in the FormData).
- Produces: form field `business_categories: number[]` (draft key); an old draft with `business_category` loads as a list of one.

- [ ] **Step 1: Write failing tests**: `scout can choose several categories and the first is the main one`, `changing the kind clears the picks`, `submit needs at least one category (message "Choose at least one category.")`, `FormData carries business_categories as a JSON array string in pick order`, `an old draft with a single business_category loads as one pick`, `the summary lists every chosen category`, `RegisterFromProspect still registers`.
- [ ] **Step 2: Run** the two files — FAIL.
- [ ] **Step 3: Implement** (replace the dropdown with `CategoryChips`; keep the existing hint for an empty category list).
- [ ] **Step 4: Run** `npx vitest run components/admin/panels/__tests__` once and the dark-mode tests — PASS.
- [ ] **Step 5: Commit** `feat(frontend): scouts choose several categories`.

### Task 9: "Your categories" card on the dashboard profile

**Files:**
- Create: `frontend/components/dashboard/panels/CategoriesCard.jsx`
- Modify: `frontend/components/dashboard/panels/ProfilePanel.jsx` (render it)
- Test: `frontend/components/dashboard/panels/__tests__/CategoriesCard.test.jsx`

**Interfaces:**
- Consumes: Task 6 `CategoryChips`, `useMyCategories`, `useRegistrationOptions(kind)`, Task 2 PUT.
- Produces: `CategoriesCard()` owns its data; shows the current categories as chips with the Main tag, lets the owner toggle and reorder (a "Make main" action on a selected chip), "Save" calls `apiPut` in a handler with try/catch + local `actionError` + refetch (no `useMutation`); copy: "These describe what you sell or do. You can still list in any category of your kind."

- [ ] **Step 1: Write failing tests**: `shows the current categories with the main one marked`, `save is disabled until something changes and until at least one is selected`, `adding a category and saving puts the new list in order`, `make main moves a category first`, `shows the server error and keeps the picks`, `without a business kind shows "Choose products or services first" instead of chips`, `never offers categories of the other kind`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run components/dashboard/panels/__tests__/CategoriesCard.test.jsx` — FAIL.
- [ ] **Step 3: Implement** and render it in `ProfilePanel` under "Business Details".
- [ ] **Step 4: Run** the file, `components/dashboard` and the dark-mode tests — PASS.
- [ ] **Step 5: Commit** `feat(frontend): owners change their categories from Profile`.

### Task 10: Staff displays list every category

**Files:**
- Modify: `frontend/components/admin/panels/KYCQueuePanel.jsx` (~line 240 "Category"), `frontend/components/admin/panels/SaBusinessDetail.jsx` (~132, ~151), `frontend/components/admin/panels/BusinessPage.jsx` (~148), `frontend/components/admin/panels/BusinessKycReview.jsx` only if it shows a category
- Test: matching existing panel tests

**Interfaces:**
- Consumes: Task 5 fields (`business_category_names`, `business_categories`, `categories`).

- [ ] **Step 1: Write failing tests**: `KYC detail shows every category, main first`, `business page and Super Admin detail list all categories`, `no categories shows "Not given"`, `an older payload with only the main category still renders`.
- [ ] **Step 2: Run** the panel tests — FAIL.
- [ ] **Step 3: Implement** (comma-separated labels; label "Categories" when more than one).
- [ ] **Step 4: Run** `npx vitest run components/admin` and the dark-mode tests — PASS.
- [ ] **Step 5: Commit** `feat(frontend): staff see every category a business has`.

### Task 11: Docs and full verification

**Files:**
- Modify: `backend/CLAUDE.md` (one bullet: single writer `accounts.categories.set_categories`, main = first link, ≥1/≤10, only where the kind is first set, never restricts listings), the spec ("Implemented" status line, "As built" section incl. the ruling below)

- [ ] **Step 1: Edit `backend/CLAUDE.md` and the spec.** Record this ruling in the spec's "As built": *a department (top-level product category) is allowed like any other category of the kind, because the scout dropdown has always listed every category of the kind; the design's line refusing a "department parent" is dropped.*
- [ ] **Step 2: Run the full backend suite** `docker compose run --rm web python manage.py test` — expect OK.
- [ ] **Step 3: Run `makemigrations --check --dry-run`** — expect "No changes detected" and a single leaf.
- [ ] **Step 4: Run the frontend suite** `cd frontend && npm run test` — expect all pass (re-run alone any load-timeout flake such as AdminCommandCenter).
- [ ] **Step 5: Commit** `docs: businesses choose several categories`. Stop; the staging deploy follows the `deploy` skill when asked.
