import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import SellerPage from './SellerPage.jsx'
import { server } from '../mocks/server.js'

const BASE = 'http://localhost:8000'
const SELLER = { id: 9, name: 'Adwoa Fabrics', since: '2026-03-02T10:00:00Z', counts: { products: 1, services: 1, stays: 0, events: 1 } }
const page = (results) => HttpResponse.json({ count: results.length, next: null, previous: null, results })
const PRODUCT = { id: 1, name: 'Kente cloth', category: { kind: 'product', is_accommodation: false } }
const SERVICE = { id: 2, name: 'Tailoring', category: { kind: 'service', is_accommodation: false } }
const EVENT = { id: 5, name: 'Cloth fair', category: { slug: 'festivals', label: 'Festivals' }, zone: { name: 'Manhyia' }, event_date: '2026-12-01T10:00:00Z' }

function StubCard({ item, onOpen }) {
  return <div onClick={() => onOpen && onOpen(item.id)}>{item.name}</div>
}

function setup({ seller = SELLER, listings = [PRODUCT, SERVICE], events = [EVENT], sellerStatus = 200 } = {}) {
  server.use(
    http.get(`${BASE}/api/listings/sellers/9/`, () => (sellerStatus === 200 ? HttpResponse.json(seller) : HttpResponse.json({ detail: 'Not found.' }, { status: sellerStatus }))),
    http.get(`${BASE}/api/listings/`, ({ request }) => {
      expect(new URL(request.url).searchParams.get('seller')).toBe('9')
      return page(listings)
    }),
    http.get(`${BASE}/api/events/`, ({ request }) => {
      expect(new URL(request.url).searchParams.get('seller')).toBe('9')
      return page(events)
    }),
  )
  const props = { id: 9, onBack: vi.fn(), user: null, favourites: [], onFavourite: vi.fn(), currency: 'GHS', onMessage: vi.fn(), onOpenListing: vi.fn(), onOpenEvent: vi.fn(), CardComponent: StubCard }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><SellerPage {...props} /></QueryClientProvider>)
  return props
}

describe('SellerPage', () => {
  it('shows the business name and when it joined, with no contact action', async () => {
    setup()
    expect(await screen.findByRole('heading', { name: 'Adwoa Fabrics' })).toBeInTheDocument()
    expect(screen.getByText(/on AshantiHub since March 2026/i)).toBeInTheDocument()
    expect(document.querySelector('a[href^="tel:"], a[href*="wa.me"]')).toBeNull()
    expect(screen.queryByText(/whatsapp|call |message the seller/i)).toBeNull()
  })

  it('offers a tab only for each kind that has live listings, and opens on the first', async () => {
    setup()
    expect(await screen.findByRole('tab', { name: /Products/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Services/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Events/ })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Stays/ })).toBeNull()
    expect(await screen.findByText('Kente cloth')).toBeInTheDocument()
    expect(screen.queryByText('Tailoring')).toBeNull()
  })

  it('switches tab to show that kind as a grid of cards', async () => {
    const props = setup()
    fireEvent.click(await screen.findByRole('tab', { name: /Services/ }))
    fireEvent.click(await screen.findByText('Tailoring'))
    expect(props.onOpenListing).toHaveBeenCalledWith(2)
    expect(screen.queryByText('Kente cloth')).toBeNull()
  })

  it('shows the seller events on the Events tab', async () => {
    const props = setup()
    fireEvent.click(await screen.findByRole('tab', { name: /Events/ }))
    fireEvent.click(await screen.findByText('Cloth fair'))
    expect(props.onOpenEvent).toHaveBeenCalledWith(5)
  })

  it('says "No live listings right now." for a seller with nothing live, with no tabs', async () => {
    setup({ seller: { ...SELLER, counts: { products: 0, services: 0, stays: 0, events: 0 } }, listings: [], events: [] })
    expect(await screen.findByText('No live listings right now.')).toBeInTheDocument()
    expect(screen.queryByRole('tab')).toBeNull()
  })

  it('says the seller is not available when the business is hidden (404)', async () => {
    const props = setup({ sellerStatus: 404 })
    expect(await screen.findByText(/isn't available/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/Back/))
    expect(props.onBack).toHaveBeenCalled()
  })
})
