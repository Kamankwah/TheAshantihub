import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import AshantiHub from './App.jsx'
import { server } from './mocks/server.js'

// The browse rail on /business and /events drives the same listing and event
// requests the old sidebar did, plus the new filters (min_rating, when) and
// the Business "Sort by" select.
const API = 'http://localhost:8000'
const EMPTY = { count: 0, next: null, previous: null, results: [] }
const TREE = [
  {
    id: 1, slug: 'electronics', label: 'Electronics', icon: '🔌', kind: 'product', is_accommodation: false, color: '#C8962E',
    children: [{ id: 2, slug: 'phones', label: 'Phones', icon: '📱', kind: 'product', is_accommodation: false, color: '#C8962E', children: [] }],
  },
  { id: 3, slug: 'hotels', label: 'Hotels', icon: '🏨', kind: 'service', is_accommodation: true, color: '#000080', children: [] },
]
// The flat useCategories() list App reads on arrival: the same categories, each with its kind.
const CATEGORIES = [
  { id: 1, slug: 'electronics', icon: '🔌', label: 'Electronics', color: '#C8962E', kind: 'product' },
  { id: 2, slug: 'phones', icon: '📱', label: 'Phones', color: '#C8962E', kind: 'product' },
  { id: 3, slug: 'hotels', icon: '🏨', label: 'Hotels', color: '#000080', kind: 'service' },
]
const DIRECT_ITEM = {
  id: 77, name: 'Shea Butter Jar', description: 'Pure shea butter.',
  category: { id: 30, slug: 'beauty', icon: '🧴', label: 'Beauty', color: '#C8962E', kind: 'product', is_accommodation: false, is_food: false, ancestors: [] },
  zone: { id: 2, name: 'Adum' }, price_amount: '40.00', effective_price: '40.00', was_price: null, discount_percent: null,
  price_unit: null, main_photo: null, photos: [], videos: [], specs: [], avg_rating: null, review_count: 0,
  variants: [], has_variants: false, variant_axes: [], stock_quantity: null,
  business_owner: { id: 3, full_name: 'ops login', name: 'Ashanti Direct', kyc_status: 'verified', is_ashanti_direct: true },
  has_warranty: false, warranty_details: '', has_expiry: false, expiry_date: null, return_policy: '',
  brand: '', condition: '', dimensions: '', weight: '',
}

// Moves the router the way a header strip, search or home link would.
function GoTo({ to }) {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate(to)}>{`test: go to ${to}`}</button>
}

class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => { window.IntersectionObserver = FakeIntersectionObserver })
afterEach(() => { delete window.IntersectionObserver })

function renderAt(path, goTo = []) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AshantiHub />
        {goTo.map((to) => <GoTo key={to} to={to} />)}
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function recordListings() {
  const calls = []
  server.use(
    http.get(`${API}/api/listings/categories/tree/`, () => HttpResponse.json(TREE)),
    http.get(`${API}/api/listings/categories/`, () => HttpResponse.json(CATEGORIES)),
    http.get(`${API}/api/marketing/featured/home/`, () => HttpResponse.json([])),
    http.get(`${API}/api/listings/`, ({ request }) => {
      calls.push(new URL(request.url).searchParams)
      return HttpResponse.json(EMPTY)
    }),
  )
  return calls
}

const last = (calls) => calls[calls.length - 1]

describe('Business page browse rail', () => {
  it('sends category and min_rating, then Clear all filters drops them', async () => {
    const calls = recordListings()
    renderAt('/business')
    const department = await screen.findByRole('navigation', { name: 'Department' }, { timeout: 4000 })
    fireEvent.click(within(department).getByRole('button', { name: 'Electronics' }))
    await waitFor(() => expect(last(calls).get('category')).toBe('electronics'))
    fireEvent.click(screen.getByRole('radio', { name: '4 stars and up' }))
    await waitFor(() => expect(last(calls).get('min_rating')).toBe('4'))
    expect(last(calls).get('category')).toBe('electronics')

    fireEvent.click(screen.getAllByRole('button', { name: /Clear all filters/ })[0])
    await waitFor(() => expect(last(calls).has('min_rating')).toBe(false))
    expect(last(calls).has('category')).toBe(false)
  }, 15000)

  it('the Sort by select sends ordering by the price paid, and Clear all filters drops it', async () => {
    const calls = recordListings()
    renderAt('/business')
    const sort = await screen.findByLabelText('Sort by', {}, { timeout: 4000 })
    // The price paid (the sale price while a discount is live), like the price filter and the cards.
    expect(within(sort).getAllByRole('option').map((o) => [o.value, o.textContent])).toEqual([
      ['', 'Newest'], ['price_effective', 'Lowest price'], ['-price_effective', 'Highest price'],
    ])
    fireEvent.change(sort, { target: { value: 'price_effective' } })
    await waitFor(() => expect(last(calls).get('ordering')).toBe('price_effective'))
    fireEvent.change(sort, { target: { value: '-price_effective' } })
    await waitFor(() => expect(last(calls).get('ordering')).toBe('-price_effective'))
    fireEvent.click(screen.getAllByRole('button', { name: /Clear all filters/ })[0])
    await waitFor(() => expect(last(calls).has('ordering')).toBe(false))
  }, 15000)

  it('Clear all filters also empties the search field and the price inputs', async () => {
    const calls = recordListings()
    renderAt('/business')
    const search = await screen.findByLabelText('Search in results', {}, { timeout: 4000 })
    fireEvent.change(search, { target: { value: 'kente' } })
    await waitFor(() => expect(last(calls).get('search')).toBe('kente'))
    fireEvent.change(screen.getByLabelText('Min price (GH₵)'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('Max price (GH₵)'), { target: { value: '90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    await waitFor(() => expect(last(calls).get('min_price')).toBe('20'))
    expect(last(calls).get('max_price')).toBe('90')

    fireEvent.click(screen.getAllByRole('button', { name: /Clear all filters/ })[0])
    await waitFor(() => expect(last(calls).has('search')).toBe(false))
    expect(last(calls).has('min_price')).toBe(false)
    expect(last(calls).has('max_price')).toBe(false)
    expect(screen.getByLabelText('Search in results')).toHaveValue('')
    expect(screen.getByLabelText('Min price (GH₵)')).toHaveValue('')
    expect(screen.getByLabelText('Max price (GH₵)')).toHaveValue('')
  }, 15000)
})

// Filters set outside the rail obey "a context change drops hidden filters":
// nothing the rail no longer shows keeps narrowing the results.
describe('Business page arrivals drop hidden filters', () => {
  it('On sale ticked, then landing on a service category: no on_sale and no kind are sent', async () => {
    const calls = recordListings()
    renderAt('/business', ['/business?category=hotels'])
    fireEvent.click(await screen.findByRole('checkbox', { name: 'On sale' }, { timeout: 4000 }))
    await waitFor(() => expect(last(calls).get('on_sale')).toBe('1'))

    fireEvent.click(screen.getByRole('button', { name: 'test: go to /business?category=hotels' }))
    await waitFor(() => expect(last(calls).get('category')).toBe('hotels'))
    await waitFor(() => expect(last(calls).has('on_sale')).toBe(false))
    expect(last(calls).has('kind')).toBe(false)
    expect(screen.queryByRole('checkbox', { name: 'On sale' })).not.toBeInTheDocument()
  }, 15000)

  it('Products chosen, then landing on a service category: kind is dropped', async () => {
    const calls = recordListings()
    renderAt('/business', ['/business?category=hotels'])
    fireEvent.click(await screen.findByRole('radio', { name: 'Products' }, { timeout: 4000 }))
    await waitFor(() => expect(last(calls).get('kind')).toBe('product'))

    fireEvent.click(screen.getByRole('button', { name: 'test: go to /business?category=hotels' }))
    await waitFor(() => expect(last(calls).get('category')).toBe('hotels'))
    expect(last(calls).has('kind')).toBe(false)
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Services' })).toBeChecked())
  }, 15000)

  it('"More from Ashanti Direct" starts a fresh browse: no leftover kind or search', async () => {
    const calls = recordListings()
    server.use(http.get(`${API}/api/listings/77/`, () => HttpResponse.json(DIRECT_ITEM)))
    renderAt('/business', ['/business/77'])
    fireEvent.click(await screen.findByRole('radio', { name: 'Services' }, { timeout: 4000 }))
    await waitFor(() => expect(last(calls).get('kind')).toBe('service'))
    fireEvent.change(screen.getByLabelText('Search in results'), { target: { value: 'kente' } })
    await waitFor(() => expect(last(calls).get('search')).toBe('kente'))

    fireEvent.click(screen.getByRole('button', { name: 'test: go to /business/77' }))
    fireEvent.click(await screen.findByRole('button', { name: 'More from Ashanti Direct' }, { timeout: 4000 }))
    await waitFor(() => expect(last(calls).get('sold_by')).toBe('direct'))
    expect(last(calls).has('kind')).toBe(false)
    expect(last(calls).has('search')).toBe(false)
    expect(await screen.findByRole('checkbox', { name: 'Sold by Ashanti Direct' })).toBeChecked()
    expect(screen.getByLabelText('Search in results')).toHaveValue('')
  }, 20000)
})

describe('Events page browse rail', () => {
  it('sends when=week for "This week" and drops it on Clear all filters', async () => {
    const calls = []
    server.use(
      http.get(`${API}/api/listings/categories/tree/`, () => HttpResponse.json(TREE)),
      http.get(`${API}/api/events/`, ({ request }) => {
        calls.push(new URL(request.url).searchParams)
        return HttpResponse.json(EMPTY)
      }),
    )
    renderAt('/events')
    fireEvent.click(await screen.findByRole('radio', { name: 'This week' }, { timeout: 4000 }))
    await waitFor(() => expect(last(calls).get('when')).toBe('week'))
    fireEvent.click(screen.getAllByRole('button', { name: /Clear all filters/ })[0])
    await waitFor(() => expect(last(calls).has('when')).toBe(false))
  }, 15000)
})
