import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import AshantiHub from './App.jsx'
import { server } from './mocks/server.js'

// The product page's "More from Ashanti Direct" applies the browse sidebar's own
// "Sold by Ashanti Direct" filter (useListings sends sold_by=direct) and returns to
// the browse grid that filter drives.
const API = 'http://localhost:8000'
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

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => { window.IntersectionObserver = FakeIntersectionObserver })
afterEach(() => { delete window.IntersectionObserver })

describe('More from Ashanti Direct', () => {
  it('sets the Sold by Ashanti Direct browse filter and goes back to the browse page', async () => {
    const soldBy = []
    server.use(
      http.get(`${API}/api/listings/77/`, () => HttpResponse.json(DIRECT_ITEM)),
      http.get(`${API}/api/listings/`, ({ request }) => {
        soldBy.push(new URL(request.url).searchParams.get('sold_by'))
        return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
      }),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/business/77']}>
          <AshantiHub />
          <Where />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'More from Ashanti Direct' }, { timeout: 4000 }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/business$/))
    await waitFor(() => expect(soldBy).toContain('direct'))
    expect(screen.queryByTestId('product-page')).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'Sold by Ashanti Direct' })).toBeChecked()
  }, 12000)
})
