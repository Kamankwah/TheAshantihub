# Frontend Marketplace API Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `App.jsx`'s hardcoded `CATEGORIES`/`LISTINGS` mock data with live calls to the `listings` backend for the public browsing experience, and establish this repo's first test framework (Vitest + React Testing Library + MSW), per `docs/superpowers/specs/2026-07-09-frontend-listing-wiring-design.md`.

**Architecture:** A small `apiClient.js` fetch helper backs four custom hooks (`useCategories`, `useZones`, `useListings`, `useListing`) built on `@tanstack/react-query`. `Card` and `MapView` are updated in place to read the real API response shape. `App.jsx`'s render logic swaps `CATEGORIES`/`LISTINGS` reads for these hooks, adding loading/error/empty states and a "Load more" pagination control. One small backend addition (pagination on the public listings endpoint) is included since the design spec calls for it.

**Tech Stack:** `@tanstack/react-query` (data fetching/caching), `vitest` + `@testing-library/react` + `@testing-library/jest-dom` (test framework, matches the existing Vite build tool), `msw` (network-level API mocking in tests). Backend: Django REST Framework's built-in `PageNumberPagination` (already available, no new dependency).

## Global Constraints

- Business-owner-facing UI (create/edit/submit listing) is explicitly out of scope — this plan only touches the public browsing experience.
- `Favourites` stays local-only client state — untouched by this plan.
- Pagination (`PageNumberPagination`, page size 20) is added ONLY to `PublicListingListView` — not as a global DRF default. `categories/`, `zones/`, the owner listing endpoints, and the moderation queue stay unpaginated.
- The new test framework covers only the new hooks/components this plan introduces (`useCategories`, `useZones`, `useListings`, `useListing`, `Card`'s/`MapView`'s updated logic) — no retroactive backfill of existing untested `App.jsx` code.
- `Card`/`MapView` consume the real API shape directly (`main_photo`, `price_amount`/`price_unit`, nested `category`/`zone` objects, `photos: [{id, image, order}]`) — no adapter/translation layer.
- `MapView` renders only the currently-loaded page(s) of `useListings`' result (same set as the grid), not every matching listing regardless of pagination.
- API base URL comes from `import.meta.env.VITE_API_BASE_URL`, defaulting to `http://localhost:8000`.
- Loading: skeleton on first fetch for a never-seen filter combination; a non-blocking "updating…" indicator (not a full skeleton) when refetching a filter combination already cached. Error: inline, retry-able. Empty: reuse the existing `"No results found. Try adjusting your filters."` div.

---

## File Structure

```
backend/
  listings/
    views.py                          # modified: add pagination to PublicListingListView
    tests/
      test_public_browsing.py         # modified: update list-endpoint assertions for paginated shape

package.json                          # modified: new deps + "test" script
vite.config.js                        # modified: add Vitest `test` config block
.env.example                          # new: VITE_API_BASE_URL
test/
  setup.js                            # new: jest-dom matchers, MSW server lifecycle
mocks/
  handlers.js                         # new: MSW request handlers (grows across tasks)
  server.js                           # new: setupServer(...handlers)
apiClient.js                          # new: shared fetch helper (base URL, error handling)
apiClient.test.js                     # new
hooks/
  useCategories.js                    # new
  useZones.js                         # new
  useListings.js                      # new
  useListing.js                       # new
  __tests__/
    useCategories.test.jsx            # new
    useZones.test.jsx                 # new
    useListings.test.jsx              # new
    useListing.test.jsx               # new
main.jsx                              # modified: wrap <App/> with QueryClientProvider
App.jsx                               # modified: Card, MapView, and AshantiHub's render logic
```

---

### Task 1: Backend — add pagination to the public listings endpoint

**Files:**
- Modify: `backend/listings/views.py`
- Modify: `backend/listings/tests/test_public_browsing.py`

**Interfaces:**
- Consumes: `PublicListingListView` (from the `listings` backend sub-project, already merged).
- Produces: `GET /api/listings/` now returns `{"count": <int>, "next": <url-or-null>, "previous": <url-or-null>, "results": [...]}` instead of a bare list, page size 20. No other endpoint's response shape changes.

- [ ] **Step 1: Update existing list-endpoint assertions in `backend/listings/tests/test_public_browsing.py` to expect the paginated shape**

Find each of these six methods in `PublicBrowsingTests` and change `response.json()` to `response.json()["results"]` wherever it's used to build an `ids`/similar list (the two detail-endpoint tests, `test_draft_listing_detail_returns_404_for_public` and `test_published_listing_detail_returns_200`, are unaffected and must NOT be changed):

```python
    def test_listings_endpoint_only_returns_published(self):
        response = self.client.get("/api/listings/")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertIn(self.published_hotel.id, ids)
        self.assertIn(self.published_food.id, ids)
        self.assertNotIn(self.draft_listing.id, ids)

    def test_filter_by_category(self):
        response = self.client.get("/api/listings/?category=hotels")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertEqual(ids, [self.published_hotel.id])

    def test_filter_by_zone(self):
        response = self.client.get("/api/listings/?zone=Adum")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertEqual(ids, [self.published_food.id])

    def test_search_by_name(self):
        response = self.client.get("/api/listings/?search=Royal")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertEqual(ids, [self.published_hotel.id])

    def test_price_range_filter(self):
        response = self.client.get("/api/listings/?min_price=100&max_price=500")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertEqual(ids, [self.published_hotel.id])

    def test_ordering_by_price(self):
        response = self.client.get("/api/listings/?ordering=price_amount")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertEqual(ids, [self.published_food.id, self.published_hotel.id])
```

- [ ] **Step 2: Add the failing pagination-shape test — append to `PublicBrowsingTests`**

```python
    def test_listings_endpoint_is_paginated(self):
        for i in range(25):
            Listing.objects.create(
                business_owner=self.owner, category=self.hotels, zone=self.manhyia,
                name=f"Extra Lodge {i}", description="Filler.",
                contact_phone="+233207334455", status=Listing.PUBLISHED,
            )
        response = self.client.get("/api/listings/")
        body = response.json()
        self.assertEqual(body["count"], 27)  # 25 new + published_hotel + published_food
        self.assertEqual(len(body["results"]), 20)
        self.assertIsNotNone(body["next"])
        self.assertIsNone(body["previous"])
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `docker compose run --rm web python manage.py test listings.tests.test_public_browsing`
Expected: FAIL — the six updated assertions get a `TypeError`/`KeyError` (current response is a bare list, `response.json()["results"]` fails), and the new pagination test's `count`/`next`/`previous` keys don't exist yet.

- [ ] **Step 4: Add pagination to `backend/listings/views.py`**

Find:
```python
class PublicListingListView(generics.ListAPIView):
    serializer_class = PublicListingSerializer
    permission_classes = [AllowAny]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "description"]
    ordering_fields = ["price_amount", "created_at"]
```

Replace with:
```python
from rest_framework.pagination import PageNumberPagination


class ListingPagination(PageNumberPagination):
    page_size = 20


class PublicListingListView(generics.ListAPIView):
    serializer_class = PublicListingSerializer
    permission_classes = [AllowAny]
    pagination_class = ListingPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "description"]
    ordering_fields = ["price_amount", "created_at"]
```

(Add the `from rest_framework.pagination import PageNumberPagination` import near the file's other `rest_framework` imports, not necessarily inline — place it wherever the existing import block convention in this file puts DRF imports.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `docker compose run --rm web python manage.py test listings.tests.test_public_browsing`
Expected: `Ran 11 tests in ...s OK`

- [ ] **Step 6: Run the full backend suite to confirm no regressions**

Run: `docker compose run --rm web python manage.py test accounts core listings`
Expected: `Ran 91 tests in ...s OK` (90 existing + 1 new; the six modified tests don't change the count, only their assertions)

- [ ] **Step 7: Commit**

```bash
git add backend/listings/
git commit -m "feat: paginate the public listings endpoint (page size 20)"
```

---

### Task 2: Frontend — test framework setup (Vitest + React Testing Library + MSW)

**Files:**
- Modify: `package.json`
- Modify: `vite.config.js`
- Create: `test/setup.js`
- Create: `mocks/handlers.js`
- Create: `mocks/server.js`
- Test: `test/smoke.test.jsx`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces: `npm run test` runs Vitest. `mocks/handlers.js` exports an (initially empty) array of MSW `http` handlers that later tasks append to. `mocks/server.js` exports a `setupServer(...handlers)` instance whose lifecycle (`listen`/`resetHandlers`/`close`) is wired into `test/setup.js`, so every later test file gets working MSW interception for free just by importing nothing extra.

- [ ] **Step 1: Add dependencies to `package.json`**

Find:
```json
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.1",
    "vite": "^5.1.4"
  }
```

Replace with:
```json
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.2",
    "@testing-library/react": "^14.2.1",
    "@vitejs/plugin-react": "^4.2.1",
    "jsdom": "^24.0.0",
    "msw": "^2.2.3",
    "vite": "^5.1.4",
    "vitest": "^1.4.0"
  }
```

Also add a `"test"` entry to `"scripts"`. Find:
```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
```

Replace with:
```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: installs cleanly, `package-lock.json` updates.

- [ ] **Step 3: Add the Vitest config block to `vite.config.js`**

Find:
```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  }
})
```

Replace with:
```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    globals: true,
  },
})
```

- [ ] **Step 4: Write `mocks/handlers.js`**

```javascript
export const handlers = []
```

- [ ] **Step 5: Write `mocks/server.js`**

```javascript
import { setupServer } from 'msw/node'
import { handlers } from './handlers.js'

export const server = setupServer(...handlers)
```

- [ ] **Step 6: Write `test/setup.js`**

```javascript
import '@testing-library/jest-dom'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from '../mocks/server.js'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

- [ ] **Step 7: Write the failing smoke test — `test/smoke.test.jsx`**

```jsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('test framework smoke test', () => {
  it('runs plain assertions', () => {
    expect(1 + 1).toBe(2)
  })

  it('renders a component with React Testing Library', () => {
    render(<div>Hello AshantiHub</div>)
    expect(screen.getByText('Hello AshantiHub')).toBeInTheDocument()
  })
})
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm run test`
Expected: `Test Files  1 passed (1)`, `Tests  2 passed (2)`

(This is the framework's own first test — there is no "RED" step here in the usual TDD sense, since the smoke test isn't testing pre-existing application code; it's proving the newly-wired config works. If `npm run test` fails, the config from Steps 1-6 has a mistake — fix that, not the test.)

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vite.config.js test/ mocks/
git commit -m "feat: add Vitest, React Testing Library, and MSW test framework"
```

---

### Task 3: Frontend — shared API client, env config, and QueryClientProvider wiring

**Files:**
- Create: `.env.example`
- Create: `apiClient.js`
- Test: `apiClient.test.js`
- Modify: `package.json`
- Modify: `main.jsx`

**Interfaces:**
- Consumes: the test framework (Task 2).
- Produces: `apiFetch(path)` — an async function that `GET`s `${VITE_API_BASE_URL}${path}`, returns parsed JSON on success, throws an `Error` with the response status on failure. Every hook in later tasks calls this instead of raw `fetch()`. `<App/>` is wrapped in a `QueryClientProvider` in `main.jsx`, so every hook in later tasks can call `useQuery`/`useInfiniteQuery` without each needing its own provider setup.

- [ ] **Step 1: Write `.env.example`**

```
VITE_API_BASE_URL=http://localhost:8000
```

- [ ] **Step 2: Write the failing test — `apiClient.test.js`**

```javascript
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from './mocks/server.js'
import { apiFetch } from './apiClient.js'

describe('apiFetch', () => {
  it('returns parsed JSON on success', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/categories/', () => {
        return HttpResponse.json([{ id: 1, slug: 'hotels', icon: '🏨', label: 'Hotels', color: '#000080' }])
      }),
    )
    const data = await apiFetch('/api/listings/categories/')
    expect(data).toEqual([{ id: 1, slug: 'hotels', icon: '🏨', label: 'Hotels', color: '#000080' }])
  })

  it('throws on a non-2xx response', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/999/', () => {
        return new HttpResponse(null, { status: 404 })
      }),
    )
    await expect(apiFetch('/api/listings/999/')).rejects.toThrow()
  })
})
```

Note the test imports `server` from `./mocks/server.js` (relative to the repo root, since this test file lives at the root alongside `apiClient.js` — not inside a subdirectory).

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL — `Cannot find module './apiClient.js'`

- [ ] **Step 4: Write `apiClient.js`**

```javascript
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

export async function apiFetch(path) {
  const response = await fetch(`${API_BASE_URL}${path}`)
  if (!response.ok) {
    throw new Error(`API request to ${path} failed with status ${response.status}`)
  }
  return response.json()
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test`
Expected: `Test Files  2 passed (2)`, `Tests  4 passed (4)` (2 from the smoke test, 2 new)

- [ ] **Step 6: Add `@tanstack/react-query` to `package.json`**

Find:
```json
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
```

Replace with:
```json
  "dependencies": {
    "@tanstack/react-query": "^5.28.4",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
```

Run: `npm install`

- [ ] **Step 7: Wire `QueryClientProvider` into `main.jsx`**

Find:
```javascript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

Replace with:
```javascript
import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.jsx'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
```

- [ ] **Step 8: Commit**

```bash
git add .env.example apiClient.js apiClient.test.js package.json package-lock.json main.jsx
git commit -m "feat: add shared API client and QueryClientProvider wiring"
```

---

### Task 4: Frontend — `useCategories` and `useZones` hooks

**Files:**
- Create: `hooks/useCategories.js`
- Create: `hooks/useZones.js`
- Modify: `mocks/handlers.js`
- Test: `hooks/__tests__/useCategories.test.jsx`
- Test: `hooks/__tests__/useZones.test.jsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 3).
- Produces: `useCategories()` → react-query result object (`.data`, `.isLoading`, `.isError`) wrapping `GET /api/listings/categories/`. `useZones()` → same shape, wrapping `GET /api/listings/zones/`. Later tasks (`App.jsx`'s render logic) consume `.data` (an array) directly.

- [ ] **Step 1: Write the failing tests**

`hooks/__tests__/useCategories.test.jsx`:
```jsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useCategories } from '../useCategories.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient()
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useCategories', () => {
  it('returns the categories list on success', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/categories/', () => {
        return HttpResponse.json([
          { id: 1, slug: 'hotels', icon: '🏨', label: 'Hotels', color: '#000080' },
          { id: 2, slug: 'food', icon: '🍲', label: 'Food', color: '#CC0000' },
        ])
      }),
    )
    const { result } = renderWithClient(() => useCategories())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toHaveLength(2)
    expect(result.current.data[0].slug).toBe('hotels')
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/categories/', () => {
        return new HttpResponse(null, { status: 500 })
      }),
    )
    const { result } = renderWithClient(() => useCategories())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
```

`hooks/__tests__/useZones.test.jsx`:
```jsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useZones } from '../useZones.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient()
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useZones', () => {
  it('returns the zones list on success', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/zones/', () => {
        return HttpResponse.json([
          { id: 1, name: 'Manhyia' },
          { id: 2, name: 'Adum' },
        ])
      }),
    )
    const { result } = renderWithClient(() => useZones())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toHaveLength(2)
    expect(result.current.data[0].name).toBe('Manhyia')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `Cannot find module '../useCategories.js'` / `'../useZones.js'`

- [ ] **Step 3: Write `hooks/useCategories.js`**

```javascript
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch('/api/listings/categories/'),
  })
}
```

- [ ] **Step 4: Write `hooks/useZones.js`**

```javascript
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useZones() {
  return useQuery({
    queryKey: ['zones'],
    queryFn: () => apiFetch('/api/listings/zones/'),
  })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test`
Expected: `Test Files  4 passed (4)`, `Tests  7 passed (7)` (4 from Tasks 2-3, 3 new)

- [ ] **Step 6: Add reusable handlers to `mocks/handlers.js`** (for use by later component-level tests, not strictly required by this task's own tests since they use `server.use()` for one-off overrides, but establishes the shared-fixture pattern early)

```javascript
import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('http://localhost:8000/api/listings/categories/', () => {
    return HttpResponse.json([
      { id: 1, slug: 'hotels', icon: '🏨', label: 'Hotels', color: '#000080' },
      { id: 2, slug: 'food', icon: '🍲', label: 'Food', color: '#CC0000' },
    ])
  }),
  http.get('http://localhost:8000/api/listings/zones/', () => {
    return HttpResponse.json([
      { id: 1, name: 'Manhyia' },
      { id: 2, name: 'Adum' },
    ])
  }),
]
```

- [ ] **Step 7: Run the full test suite to confirm no regressions**

Run: `npm run test`
Expected: `Test Files  4 passed (4)`, `Tests  7 passed (7)` (adding default handlers doesn't change existing counts, since each test file's `server.use()` calls override them per-test)

- [ ] **Step 8: Commit**

```bash
git add hooks/useCategories.js hooks/useZones.js hooks/__tests__/useCategories.test.jsx hooks/__tests__/useZones.test.jsx mocks/handlers.js
git commit -m "feat: add useCategories and useZones hooks"
```

---

### Task 5: Frontend — `useListings` hook (paginated, filtered)

**Files:**
- Create: `hooks/useListings.js`
- Test: `hooks/__tests__/useListings.test.jsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 3), the backend's paginated response shape (Task 1).
- Produces: `useListings(filters)` — wraps `useInfiniteQuery`. `filters` is `{ category, zone, search, minPrice, maxPrice, ordering }` (any subset, all optional). Returns the standard `useInfiniteQuery` result shape: `.data.pages` (array of page responses, each `{count, next, previous, results}`), `.fetchNextPage()`, `.hasNextPage`, `.isLoading`, `.isFetching`, `.isError`. Later tasks (`App.jsx`) flatten `.data.pages.flatMap(page => page.results)` to get the combined listing array, and wire a "Load more" button to `.fetchNextPage()` gated on `.hasNextPage`.

- [ ] **Step 1: Write the failing test — `hooks/__tests__/useListings.test.jsx`**

```jsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useListings } from '../useListings.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient()
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

const PAGE_ONE = {
  count: 25,
  next: 'http://localhost:8000/api/listings/?page=2',
  previous: null,
  results: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Listing ${i + 1}` })),
}

const PAGE_TWO = {
  count: 25,
  next: null,
  previous: 'http://localhost:8000/api/listings/?page=1',
  results: Array.from({ length: 5 }, (_, i) => ({ id: i + 21, name: `Listing ${i + 21}` })),
}

describe('useListings', () => {
  it('fetches the first page and exposes pagination info', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/', () => HttpResponse.json(PAGE_ONE)),
    )
    const { result } = renderWithClient(() => useListings({}))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.pages[0].results).toHaveLength(20)
    expect(result.current.hasNextPage).toBe(true)
  })

  it('fetches the next page when fetchNextPage is called', async () => {
    let callCount = 0
    server.use(
      http.get('http://localhost:8000/api/listings/', () => {
        callCount += 1
        return HttpResponse.json(callCount === 1 ? PAGE_ONE : PAGE_TWO)
      }),
    )
    const { result } = renderWithClient(() => useListings({}))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    result.current.fetchNextPage()
    await waitFor(() => expect(result.current.data.pages).toHaveLength(2))
    expect(result.current.data.pages[1].results).toHaveLength(5)
    expect(result.current.hasNextPage).toBe(false)
  })

  it('includes filter params in the request', async () => {
    let capturedUrl
    server.use(
      http.get('http://localhost:8000/api/listings/', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json(PAGE_ONE)
      }),
    )
    const { result } = renderWithClient(() =>
      useListings({ category: 'hotels', zone: 'Adum', search: 'lodge', minPrice: 100, maxPrice: 500, ordering: 'price_amount' }),
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const url = new URL(capturedUrl)
    expect(url.searchParams.get('category')).toBe('hotels')
    expect(url.searchParams.get('zone')).toBe('Adum')
    expect(url.searchParams.get('search')).toBe('lodge')
    expect(url.searchParams.get('min_price')).toBe('100')
    expect(url.searchParams.get('max_price')).toBe('500')
    expect(url.searchParams.get('ordering')).toBe('price_amount')
  })

  it('refetches when filters change (different query key)', async () => {
    let requestCount = 0
    server.use(
      http.get('http://localhost:8000/api/listings/', () => {
        requestCount += 1
        return HttpResponse.json(PAGE_ONE)
      }),
    )
    const queryClient = new QueryClient()
    const { result, rerender } = renderHook(
      ({ filters }) => useListings(filters),
      {
        initialProps: { filters: { category: 'hotels' } },
        wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
      },
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(requestCount).toBe(1)
    rerender({ filters: { category: 'food' } })
    await waitFor(() => expect(requestCount).toBe(2))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL — `Cannot find module '../useListings.js'`

- [ ] **Step 3: Write `hooks/useListings.js`**

```javascript
import { useInfiniteQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

function buildQueryString(filters, page) {
  const params = new URLSearchParams()
  if (filters.category) params.set('category', filters.category)
  if (filters.zone) params.set('zone', filters.zone)
  if (filters.search) params.set('search', filters.search)
  if (filters.minPrice != null) params.set('min_price', filters.minPrice)
  if (filters.maxPrice != null) params.set('max_price', filters.maxPrice)
  if (filters.ordering) params.set('ordering', filters.ordering)
  if (page) params.set('page', page)
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function useListings(filters) {
  return useInfiniteQuery({
    queryKey: ['listings', filters],
    queryFn: ({ pageParam }) => apiFetch(`/api/listings/${buildQueryString(filters, pageParam)}`),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => {
      if (!lastPage.next) return undefined
      return new URL(lastPage.next).searchParams.get('page')
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test`
Expected: `Test Files  5 passed (5)`, `Tests  11 passed (11)` (7 existing + 4 new)

- [ ] **Step 5: Commit**

```bash
git add hooks/useListings.js hooks/__tests__/useListings.test.jsx
git commit -m "feat: add useListings hook with pagination and server-side filters"
```

---

### Task 6: Frontend — `useListing` hook (detail)

**Files:**
- Create: `hooks/useListing.js`
- Test: `hooks/__tests__/useListing.test.jsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 3).
- Produces: `useListing(id)` → react-query result wrapping `GET /api/listings/<id>/`. `.isError` distinguishes a 404 (listing not found/not published) from other errors only insofar as `apiFetch` throws for any non-2xx — later tasks treat any `isError` on this hook as "not found" per the design spec's §4, since the only expected failure mode for a valid numeric ID on this endpoint is 404.

- [ ] **Step 1: Write the failing test — `hooks/__tests__/useListing.test.jsx`**

```jsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useListing } from '../useListing.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient()
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useListing', () => {
  it('returns the listing detail on success', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => {
        return HttpResponse.json({ id: 1, name: 'Royal Ashanti Lodge' })
      }),
    )
    const { result } = renderWithClient(() => useListing(1))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.name).toBe('Royal Ashanti Lodge')
  })

  it('exposes isError for a 404', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/999/', () => {
        return new HttpResponse(null, { status: 404 })
      }),
    )
    const { result } = renderWithClient(() => useListing(999))
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL — `Cannot find module '../useListing.js'`

- [ ] **Step 3: Write `hooks/useListing.js`**

```javascript
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useListing(id) {
  return useQuery({
    queryKey: ['listing', id],
    queryFn: () => apiFetch(`/api/listings/${id}/`),
    enabled: id != null,
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test`
Expected: `Test Files  6 passed (6)`, `Tests  13 passed (13)` (11 existing + 2 new)

- [ ] **Step 5: Commit**

```bash
git add hooks/useListing.js hooks/__tests__/useListing.test.jsx
git commit -m "feat: add useListing detail hook"
```

---

### Task 7: Frontend — update `Card` to consume the real API shape

**Files:**
- Modify: `App.jsx` (the `Card` function, currently at line ~1886 as of this plan's writing — search for `function Card({item,` rather than trusting the line number, since earlier tasks in this plan don't touch line count above it but later manual edits might)
- Test: `Card.test.jsx`

**Interfaces:**
- Consumes: nothing from prior tasks directly (pure component prop-shape change), but the shape it now expects matches what `useListings`/`useListing` (Tasks 5-6) actually return from the real backend (per `PublicListingSerializer` in `backend/listings/serializers.py`): `{id, name, description, category: {slug, icon, label, color}, zone: {name}, price_amount, price_unit, tag, contact_phone, lat, lng, main_photo, photos: [{id, image, order}], created_at}`.
- Produces: `Card` renders correctly given this real shape. Later tasks (`App.jsx`'s main render, Task 9) pass real API listing objects to `Card` instead of mock-shaped ones.

- [ ] **Step 1: Read the current `Card` function in `App.jsx` before writing the test**

Run: `grep -n "^function Card" App.jsx` to confirm its current line, then read that function's full body (it reads `item.img`, `item.price`, `item.tag`, `item.rating`, `item.reviews`, `item.name`, `item.desc`, `item.photos` as an emoji array, and calls `onWhatsApp`/`onFavourite`/`onMessage` — the props unrelated to display fields, like `onWhatsApp`, `favourites`, `user`, `currency`, `onMessage`, are unchanged by this task).

- [ ] **Step 2: Write the failing test — `Card.test.jsx`**

```jsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Card } from './App.jsx'

const REAL_SHAPED_LISTING = {
  id: 1,
  name: 'Royal Ashanti Lodge',
  description: 'Luxury rooms with kente-draped interiors.',
  category: { slug: 'hotels', icon: '🏨', label: 'Hotels', color: '#000080' },
  zone: { name: 'Manhyia' },
  price_amount: '450.00',
  price_unit: '/night',
  tag: 'Featured',
  contact_phone: '+233244000001',
  lat: '6.688500',
  lng: '-1.624400',
  main_photo: 'http://localhost:8000/media/listing_photos/main/lodge.jpg',
  photos: [],
  created_at: '2026-07-09T00:00:00Z',
}

describe('Card with real API shape', () => {
  it('renders the listing name, price, and zone from the real shape', () => {
    render(
      <Card
        item={REAL_SHAPED_LISTING}
        accentColor="#000080"
        onWhatsApp={vi.fn()}
        user={null}
        favourites={[]}
        onFavourite={vi.fn()}
        currency="GHS"
        onMessage={vi.fn()}
      />,
    )
    expect(screen.getByText('Royal Ashanti Lodge')).toBeInTheDocument()
    expect(screen.getByText(/450/)).toBeInTheDocument()
    expect(screen.getByText(/Manhyia/)).toBeInTheDocument()
  })

  it('renders the main_photo as an image when present', () => {
    render(
      <Card
        item={REAL_SHAPED_LISTING}
        accentColor="#000080"
        onWhatsApp={vi.fn()}
        user={null}
        favourites={[]}
        onFavourite={vi.fn()}
        currency="GHS"
        onMessage={vi.fn()}
      />,
    )
    const img = screen.getByRole('img', { name: /Royal Ashanti Lodge/i })
    expect(img).toHaveAttribute('src', REAL_SHAPED_LISTING.main_photo)
  })
})
```

`Card` is not currently exported from `App.jsx` (it's a bare top-level `function` in a monolith with only `export default function AshantiHub()` at the bottom, per `CLAUDE.md`). Before this test can even fail meaningfully, add `export` to the `Card` function declaration in this same step's investigation — Step 1 already had you locate it; change `function Card({item,...` to `export function Card({item,...` as part of writing this test (this is a one-word, zero-behavior-change addition, not a refactor, so it doesn't need its own separate TDD cycle).

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL — assertions fail because `Card` currently reads `item.img`/`item.price`/`item.photos` (emoji array)/no zone display in this form, not the new field names.

- [ ] **Step 4: Update `Card` in `App.jsx` to read the real field names**

Locate every place inside `Card`'s body that reads a mock-shaped field and change it to the real one:
- `item.price` (a combined display string) → `` `GHS ${item.price_amount}${item.price_unit || ''}` `` (or the currency-converted equivalent, reusing whatever existing `currency`/`CURRENCIES` conversion logic already multiplies a numeric price — apply that conversion to `item.price_amount` instead of the old `item.priceNum`).
- `item.img` (an emoji used as a placeholder icon) → replaced by an actual `<img src={item.main_photo} alt={item.name} />` when `item.main_photo` is truthy, falling back to the category's `item.category.icon` emoji (as a text/emoji placeholder, not an `<img>`) when `item.main_photo` is null.
- Any existing zone/location display → `item.zone.name` (was previously reading a plain `item.zone` string in the mock data; now it's a nested object's `.name`).
- `item.photos` (previously an array of emoji strings rendered as a mini gallery strip) → `item.photos` is now an array of `{id, image, order}` — render `item.photos.map(p => <img key={p.id} src={p.image} .../>)` instead of rendering emoji characters directly.
- Category color/accent lookups that referenced `item`'s own fields for category info now read `item.category.color`/`item.category.icon` directly (the nested object), rather than looking category info up separately via the old top-level `CATEGORIES.find(...)` pattern for this specific card (that broader lookup pattern used elsewhere in `App.jsx`, e.g. in `MapView`, is Task 8's concern, not this one's).

Do not change `Card`'s other props (`onWhatsApp`, `favourites`, `user`, `currency`, `onMessage`, `accentColor`) or their usage — this task only touches how `item`'s own fields are read and displayed.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test`
Expected: `Test Files  7 passed (7)`, `Tests  15 passed (15)` (13 existing + 2 new)

- [ ] **Step 6: Commit**

```bash
git add App.jsx Card.test.jsx
git commit -m "feat: update Card to consume the real listing API shape"
```

---

### Task 8: Frontend — update `MapView` to consume the real API shape

**Files:**
- Modify: `App.jsx` (the `MapView` function)
- Test: `MapView.test.jsx`

**Interfaces:**
- Consumes: the same real listing shape as Task 7.
- Produces: `MapView` renders map pins from a real-shaped listings array passed in directly (no more internal `LISTINGS`/`CATEGORIES` lookups) — later tasks (`App.jsx`'s main render, Task 9) pass it the flattened, already-filtered result of `useListings` instead of the mock `LISTINGS` object plus a category id.

- [ ] **Step 1: Read the current `MapView` function in `App.jsx` before writing the test**

Run: `grep -n "^function MapView" App.jsx`, read its full body. Note its current signature `MapView({allListings, activeCategory})` — it takes the *entire* mock `LISTINGS` object plus a category id string, and does its own filtering internally (`activeCategory==="all"?items:(LISTINGS[activeCategory]||[]).filter(i=>i.lat)`).

- [ ] **Step 2: Write the failing test — `MapView.test.jsx`**

```jsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MapView } from './App.jsx'

const REAL_SHAPED_LISTINGS = [
  {
    id: 1, name: 'Royal Ashanti Lodge', lat: '6.688500', lng: '-1.624400',
    category: { slug: 'hotels', icon: '🏨', label: 'Hotels', color: '#000080' },
    zone: { name: 'Manhyia' },
  },
  {
    id: 2, name: 'No Coordinates Cafe', lat: null, lng: null,
    category: { slug: 'food', icon: '🍲', label: 'Food', color: '#CC0000' },
    zone: { name: 'Adum' },
  },
]

describe('MapView with real API shape', () => {
  it('renders a pin for each listing that has coordinates', () => {
    render(<MapView listings={REAL_SHAPED_LISTINGS} />)
    expect(screen.getByText('Royal Ashanti Lodge')).toBeInTheDocument()
    expect(screen.queryByText('No Coordinates Cafe')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL — `MapView` is not exported, and/or its signature doesn't accept a plain `listings` array prop yet.

- [ ] **Step 4: Update `MapView` in `App.jsx`**

Change the signature from `function MapView({allListings, activeCategory})` to `export function MapView({listings})`. Remove the internal `LISTINGS[activeCategory]`/`CATEGORIES.find(...)` lookups entirely — replace the body's filtering logic (`const filtered = activeCategory==="all"?items:...`) with simply `const filtered = listings.filter(i => i.lat && i.lng)`, since filtering by category now happens server-side (the caller passes in an already-filtered array). Update any per-pin rendering inside `MapView` that reads `item.zone` (plain string) or category-color-by-lookup to read `item.zone.name` and `item.category.color`/`item.category.icon` directly, matching Task 7's field-shape changes.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test`
Expected: `Test Files  8 passed (8)`, `Tests  16 passed (16)` (15 existing + 1 new)

- [ ] **Step 6: Commit**

```bash
git add App.jsx MapView.test.jsx
git commit -m "feat: update MapView to consume a pre-filtered real-shaped listings array"
```

---

### Task 9: Frontend — wire `AshantiHub`'s render to the new hooks, remove mock data, add loading/error/pagination UI

**Files:**
- Modify: `App.jsx` (the `AshantiHub` function's state/render logic; deletion of the `CATEGORIES`/`LISTINGS` constants)

**Interfaces:**
- Consumes: `useCategories`, `useZones`, `useListings` (Tasks 4-5), the updated `Card`/`MapView` (Tasks 7-8).
- Produces: the marketplace view (category tabs, listing grid, map, search/filter controls) is driven entirely by live data. `CATEGORIES` and `LISTINGS` (and `MOCK_REVIEWS`, `KUMASI_ZONES`, `CAT_IMAGES` insofar as they reference `LISTINGS`/`CATEGORIES` — check each before deleting, some like `CURRENCIES`/`KUMASI_PHOTOS` are unrelated and must stay) no longer exist in the file.

This task has no isolated automated test of its own — `AshantiHub` is the top-level app component wiring everything else together, and per `docs/superpowers/specs/2026-07-09-frontend-listing-wiring-design.md` §6, broader `App.jsx` coverage beyond the specific hooks/components already tested (Tasks 2-8) is out of scope for this plan. Verification for this task is manual, per that spec's §6 and `CLAUDE.md`'s existing convention.

- [ ] **Step 1: Locate every read of `CATEGORIES`/`LISTINGS` inside `AshantiHub`'s body and in any sibling top-level function that isn't `Card`/`MapView`** (both already handled in Tasks 7-8)

Run: `grep -n "CATEGORIES\|LISTINGS\[" App.jsx` and review every remaining hit inside `AshantiHub` (the ones inside `Card`/`MapView` were already replaced in Tasks 7-8, so should no longer appear there — if any still do, Tasks 7-8 were incomplete; fix them as part of this step, don't proceed with a half-migrated `Card`/`MapView`).

- [ ] **Step 2: Add the three hooks to `AshantiHub` and derive the flattened listings array**

Near `AshantiHub`'s existing `useState` declarations (e.g. right after `const [favourites,setFavourites]=useState([]);`), add:
```javascript
const [filters, setFilters] = useState({});
const { data: categories, isLoading: categoriesLoading } = useCategories();
const { data: zones, isLoading: zonesLoading } = useZones();
const {
  data: listingsData,
  isLoading: listingsLoading,
  isFetching: listingsFetching,
  isError: listingsError,
  fetchNextPage,
  hasNextPage,
  refetch: refetchListings,
} = useListings(filters);
const listings = listingsData ? listingsData.pages.flatMap((page) => page.results) : [];
```

Add the import at the top of `App.jsx` alongside its other imports:
```javascript
import { useCategories } from './hooks/useCategories.js';
import { useZones } from './hooks/useZones.js';
import { useListings } from './hooks/useListings.js';
```

- [ ] **Step 3: Replace category-tab rendering to map over `categories` instead of the `CATEGORIES` constant**

Find wherever `AshantiHub` currently maps over `CATEGORIES` to render category tab buttons (setting `activeCategory`/`activeCat` on click). Change the `.map(CATEGORIES, ...)`/`CATEGORIES.map(...)` call to map over `categories || []` instead, and update the click handler to set `filters` (e.g. `setFilters(f => ({...f, category: cat.slug}))`) instead of a bare `activeCategory` state, replacing every downstream reference to the old `activeCategory`/`activeCat` state with a read from `filters.category` (and the matching category object looked up from `categories` by `slug` where the UI needs the label/icon/color, e.g. `categories?.find(c => c.slug === filters.category)`).

- [ ] **Step 4: Replace the results grid's data source**

Find where `getFiltered()` (or the grid's direct `LISTINGS[activeCat]` read) currently supplies `.map(item => <Card .../>)`. Replace the call feeding that `.map` with `listings` (from Step 2). Wire the existing zone-dropdown/search-box/price-range inputs' `onChange` handlers to update `filters` (e.g. `setFilters(f => ({...f, zone: e.target.value}))`, `setFilters(f => ({...f, search: e.target.value}))`, etc.) instead of whatever local filtering state they previously drove.

- [ ] **Step 5: Add loading, error, and empty states around the results grid**

Wrap the grid's render logic:
```javascript
{listingsLoading ? (
  <ListingsSkeleton />
) : listingsError ? (
  <div style={{textAlign:"center",padding:"30px"}}>
    Something went wrong loading listings.{" "}
    <button onClick={() => refetchListings()}>Retry</button>
  </div>
) : listings.length === 0 ? (
  <div>No results found. Try adjusting your filters.</div>
) : (
  <>
    {listingsFetching && <div style={{height:3,background:C.gold}} />}
    {listings.map(item => <Card key={item.id} item={item} .../>)}
    {hasNextPage && <button onClick={() => fetchNextPage()}>Load more</button>}
  </>
)}
```
(Preserve the exact existing `"No results found. Try adjusting your filters."` div and its surrounding style — do not introduce new copy for the empty state, per the design spec's §4 explicit instruction to reuse it as-is. `ListingsSkeleton` is a small new top-level function, styled to roughly match `Card`'s existing dimensions with a muted placeholder background — write it as a simple `.map` over a fixed-size placeholder array, e.g. `Array.from({length: 6})`, no animation library needed.)

- [ ] **Step 6: Update `MapView`'s call site**

Find `<MapView allListings={LISTINGS} activeCategory={activeCat}/>` and replace with `<MapView listings={listings}/>`, matching Task 8's new signature.

- [ ] **Step 7: Delete the now-unused mock constants**

Remove the `CATEGORIES` and `LISTINGS` constant declarations entirely (confirmed unused by this point via Step 1's grep). Check `MOCK_REVIEWS`, `CAT_IMAGES`, and any other constant that references `LISTINGS`/`CATEGORIES` by key — `MOCK_REVIEWS` is keyed by listing `id` and is unrelated to this plan's scope (Reviews are explicitly deferred per the design spec), so leave it as dead-but-harmless mock data for now rather than deleting something outside this task's stated scope; `CAT_IMAGES` (hero images per category slug) has no equivalent backend field yet (`Category` has no hero-image field) — leave it in place and used only for now if anything still references it after Steps 1-6, or delete it if grep confirms it's now unreferenced. Do not delete `KUMASI_ZONES`, `CURRENCIES`, or `KUMASI_PHOTOS` — none of these are the mock listings/categories data this task targets.

- [ ] **Step 8: Manual verification**

Run: `npm run dev`, then in a browser:
- Confirm category tabs render from the real seeded categories (15 of them) and switching tabs shows a brief loading indicator then real (likely empty, since no real listings exist yet outside test data) results.
- Confirm the empty-state message appears for every category (expected, since no listings have been created through the real registration+moderation flow yet).
- Confirm zone/search/price filter inputs update the displayed `filters` state (check via browser devtools network tab that the right query params are sent).
- Confirm map view toggling still renders without crashing given an empty listings array.
- Throttle network in devtools and confirm the error/retry UI appears on a simulated failure (e.g. by temporarily stopping the backend `docker compose` container).

- [ ] **Step 9: Run the full frontend test suite one final time**

Run: `npm run test`
Expected: `Test Files  8 passed (8)`, `Tests  16 passed (16)` (unchanged from Task 8 — this task has no new automated tests per its own Interfaces section)

- [ ] **Step 10: Commit**

```bash
git add App.jsx
git commit -m "feat: wire AshantiHub's marketplace view to live listings/categories/zones API"
```

---

## Notes for future sub-projects

- **Business-owner-facing UI** (create/edit/submit listing, photo upload) needs real frontend authentication first — a separate sub-project.
- **Reviews** (`MOCK_REVIEWS`) — deferred, per `docs/PROJECT_SCOPE.md` §5a Day 5.
- **Broader `App.jsx` test coverage** beyond what this plan added — an explicit, separate future decision, not an implicit consequence of this plan landing the test framework.
