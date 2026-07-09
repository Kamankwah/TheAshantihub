# Design: Frontend Marketplace API Wiring

**Date:** 2026-07-09
**Status:** Approved, not yet implemented
**Sub-project:** Follows on from `docs/superpowers/specs/2026-07-09-listing-model-design.md` (the `listings` backend, merged into `main`). This spec covers the deferred "actually wiring App.jsx" item from that spec's §1.

## 1. Background & scope

`App.jsx` currently renders the entire marketplace from two hardcoded constants: `CATEGORIES` (15 fixed categories) and `LISTINGS` (mock business entries keyed by category). The `listings` backend now provides real endpoints for both. This spec replaces the mock-data reads with live API calls for the **public browsing experience only** — category tabs, listing cards, search/filter, map view, listing detail.

**Out of scope for this spec** (deliberately deferred):
- Any business-owner-facing UI (create/edit/submit listing, photo upload) — the frontend has no real authentication today (`user`/`authModal` are local-only stubs per `CLAUDE.md`), and building owner-facing screens without real login first would mean building throwaway UI. That work waits on a frontend-auth sub-project.
- Phone-OTP auth, Reviews, staff-facing moderation UI — unrelated/separate sub-projects, same as the backend spec's deferrals.
- `Favourites` stays local-only client state (no `Favourite` model exists in the backend; unaffected by this spec).

## 2. Architecture

- **Data-fetching library:** `@tanstack/react-query` — the project's first data-fetching dependency. Chosen over plain `fetch()`+`useEffect` for built-in caching, loading/error state, and paginated fetching (`useInfiniteQuery`), which this spec needs regardless (see §5 pagination).
- **API base URL:** `import.meta.env.VITE_API_BASE_URL`, defaulting to `http://localhost:8000` for local dev (matches `docker-compose.yml`'s port 8000). Set via `.env`/`.env.production` for other environments (Vercel, VPS) — standard Vite pattern, no new dependency for this part.
- **Custom hooks**, one per concern:
  - `useCategories()` — `GET /api/listings/categories/`, unpaginated (15 rows).
  - `useZones()` — `GET /api/listings/zones/`, unpaginated (9 rows).
  - `useListings(filters)` — `GET /api/listings/?category=&zone=&search=&min_price=&max_price=&ordering=&page=`, paginated (see §5). `filters` changes (category tab, zone dropdown, search box, price range) are the query key — react-query treats any change as needing a fresh fetch.
  - `useListing(id)` — `GET /api/listings/<id>/`, single detail, unpaginated.
- **Component updates, not adapters:** `Card` and `MapView` are updated in place to consume the real API shape directly — `main_photo` (a real image URL), `price_amount`/`price_unit` (structured, not a combined display string), nested `category`/`zone` objects (not string ids), `photos: [{id, image, order}]` (not an emoji array). No translation/adapter layer between the API and these components.

## 3. Data flow

- Category tabs, zone dropdown, search box, and price-range inputs all write into a single `filters` object held in `AshantiHub`'s state (or wherever the current `activeCategory`/`search` state already lives), passed to `useListings(filters)`.
- `useListings` wraps `useInfiniteQuery`; `getNextPageParam` reads the paginated response's `next` field.
- `MapView` consumes `useListings`' already-filtered result directly — it previously did its own category-based filtering internally on the full `LISTINGS` object; that filtering now happens server-side via the `?category=` param, so `MapView` just renders whatever `useListings` currently holds. This means the map shows only the currently-*loaded* page(s) (the same set as the grid), not every matching listing regardless of pagination — consistent with the grid, and simple. Given near-zero real listing volume at this stage, showing "all matching pins on the map, paginated cards below" is not worth the added complexity now; revisit only if map completeness becomes a real gap once listing volume grows.
- `Card`'s WhatsApp/favourite/currency-conversion behavior (`handleWA`, `toggleFav`, `CURRENCIES` conversion) is unaffected — only the fields it reads to *display* the listing change.

## 4. Loading, error, and empty states

- **Loading:** a skeleton matching the existing card grid's dimensions, shown while `useListings`'s `isLoading` is true (first fetch for a filter combination never seen before). When switching to a filter combination react-query already has cached (`isFetching` true but `isLoading` false), the previously-cached results stay visible with a small, non-blocking "updating…" indicator (e.g. a thin progress bar) rather than either a full skeleton or no indicator at all — avoids a jarring full-grid blank on every tab switch while still signaling that a refetch is in flight.
- **Error:** an inline, retry-able message (wired to react-query's `refetch()`) on `isError` — no blank screen, no uncaught exception.
- **Empty:** the existing `"No results found. Try adjusting your filters."` div (already present in the results grid for the zero-mock-results case) is reused as-is when the API returns zero results and the query isn't loading.
- **404 on listing detail:** a distinct "Listing not found" message (the listing doesn't exist, was never published, or was un-published) — distinguished from the generic network-error case.

## 5. Pagination (small backend addition)

The backend's final review flagged that list endpoints have no pagination. This spec adds `pagination_class = PageNumberPagination` (page size 20) to `PublicListingListView` specifically — not as a global DRF default, so `categories/`, `zones/`, the owner's own listing list, and the staff moderation queue all stay unpaginated (their result sets are naturally small: 15/9 rows, or bounded by one owner's/the pending queue's realistic size). The public listings response shape becomes `{count, next, previous, results: [...]}`.

**Frontend pagination UI:** a "Load more" button at the bottom of the results grid, which fetches and appends the next page via `useInfiniteQuery`'s `fetchNextPage()` — minimal change to the existing single-scroll grid layout.

## 6. Testing considerations

This repo has no test framework (`CLAUDE.md`: no Jest/Vitest, no test script, no lint/typecheck setup) — this has been true since the prototype stage and this spec doesn't change it. Verification is manual, per the existing project convention: `npm run dev`, exercise the golden path (browse each category, filter by zone/price, search, view a listing's detail, map view, paginate past page 1) and edge cases (a category with zero published listings, a slow/failed network via devtools throttling, a stale/deleted listing ID) in a browser.

## 7. Open questions

None — all decisions in this spec were confirmed during brainstorming (2026-07-09).
