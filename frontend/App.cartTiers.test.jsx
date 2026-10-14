import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import AshantiHub from './App.jsx'
import { setStoredAuth } from './apiClient.js'
import { server } from './mocks/server.js'

// Cart-aware search (cart_tiers=1) is asked for only by a customer whose cart holds something.
const CART_WITH_ITEM = { id: 1, items: [{ id: 10, listing: 5, listing_name: 'Kente Cloth', quantity: 1, unit_price_snapshot: '150.00', line_total: '150.00', added_at: '2026-07-10T00:00:00Z' }], total: '150.00', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-10T00:00:00Z' }
const EMPTY_CART = { id: 1, items: [], total: '0.00', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' }

function setup(accountType, cart) {
  if (accountType) {
    setStoredAuth({ token: 'test-token', account_type: accountType, id: 2, full_name: 'Test User' })
    server.use(http.get('http://localhost:8000/api/accounts/me/', () => HttpResponse.json({ account_type: accountType, id: 2, full_name: 'Test User' })))
  }
  const seen = { tiers: [], cartCalls: 0, guardCalls: 0 }
  server.use(
    http.get('http://localhost:8000/api/cart/', () => { seen.cartCalls += 1; return HttpResponse.json(cart) }),
    http.get('http://localhost:8000/api/cart/guard/', () => { seen.guardCalls += 1; return HttpResponse.json({}) }),
    http.get('http://localhost:8000/api/listings/', ({ request }) => {
      seen.tiers.push(new URL(request.url).searchParams.get('cart_tiers'))
      return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
    }),
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/']}><AshantiHub /></MemoryRouter>
    </QueryClientProvider>,
  )
  return seen
}

afterEach(() => setStoredAuth(null))

describe('App cart tiers request gating', () => {
  it('a customer with an item in the cart searches with cart_tiers=1', async () => {
    const seen = setup('customer', CART_WITH_ITEM)
    await waitFor(() => expect(seen.tiers).toContain('1'), { timeout: 5000 })
  }, 10000)

  it.each([
    ['a guest', null, EMPTY_CART],
    ['a customer with an empty cart', 'customer', EMPTY_CART],
    ['a business account (even with a cart row)', 'business_owner', CART_WITH_ITEM],
  ])('%s never asks for cart tiers', async (_label, type, cart) => {
    const seen = setup(type, cart)
    await waitFor(() => expect(seen.tiers.length).toBeGreaterThan(0), { timeout: 5000 })
    await new Promise((r) => setTimeout(r, 300))
    expect(seen.tiers.every((t) => t === null)).toBe(true)
    expect(screen.queryByText('See other shops too')).not.toBeInTheDocument()
  }, 10000)
})
