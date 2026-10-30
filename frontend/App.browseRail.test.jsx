import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
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
]

class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => { window.IntersectionObserver = FakeIntersectionObserver })
afterEach(() => { delete window.IntersectionObserver })

function renderAt(path) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AshantiHub />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function recordListings() {
  const calls = []
  server.use(
    http.get(`${API}/api/listings/categories/tree/`, () => HttpResponse.json(TREE)),
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

  it('the Sort by select sends ordering, and Clear all filters drops it', async () => {
    const calls = recordListings()
    renderAt('/business')
    const sort = await screen.findByLabelText('Sort by', {}, { timeout: 4000 })
    fireEvent.change(sort, { target: { value: 'price_amount' } })
    await waitFor(() => expect(last(calls).get('ordering')).toBe('price_amount'))
    fireEvent.click(screen.getAllByRole('button', { name: /Clear all filters/ })[0])
    await waitFor(() => expect(last(calls).has('ordering')).toBe(false))
  }, 15000)
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
