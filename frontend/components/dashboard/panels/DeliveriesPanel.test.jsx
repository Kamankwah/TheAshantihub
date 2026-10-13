import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import DeliveriesPanel from './DeliveriesPanel.jsx'
import { server } from '../../../mocks/server.js'

function renderPanel(orders) {
  server.use(
    http.get('http://localhost:8000/api/orders/owner/', () =>
      HttpResponse.json({ count: orders.length, next: null, previous: null, results: orders })),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><DeliveriesPanel /></QueryClientProvider>)
}

const DOOR_TO_DOOR_ORDER = {
  id: 7, customer_name: 'Yaw Mensah', status: 'paid', delivery_status: 'processing',
  placed_at: '2026-10-05T09:30:00Z', owner_subtotal: '250.00',
  items: [{ id: 1, listing: 1, listing_name: 'Handwoven kente stole', quantity: 1 }],
  delivery_method: 'door_to_door', delivery_address: 'Bantama, Kumasi',
}

describe('DeliveriesPanel', () => {
  it("shows the customer's name and delivery address", async () => {
    renderPanel([DOOR_TO_DOOR_ORDER])
    expect(await screen.findByText(/Order #7 · Yaw Mensah/)).toBeInTheDocument()
    expect(screen.getByText(/Bantama, Kumasi/)).toBeInTheDocument()
  })

  it("never shows the customer's phone, even if the API sends one", async () => {
    renderPanel([{ ...DOOR_TO_DOOR_ORDER, delivery_phone: '0200000201' }])
    await screen.findByText(/Bantama, Kumasi/)
    expect(screen.queryByText(/0200000201/)).not.toBeInTheDocument()
  })
})

describe('DeliveriesPanel rider tracking (vendor)', () => {
  const API = 'http://localhost:8000'
  const trackWith = (payload) => {
    const calls = []
    server.use(http.get(`${API}/api/orders/owner/:id/tracking/`, () => { calls.push(1); return HttpResponse.json(payload) }))
    return calls
  }
  const HEADING = {
    stage: 'accepted', pickup: { lat: 5.6037, lng: -0.187, name: 'Akosua Ntoma' },
    rider: { first_name: 'Kojo', vehicle_type: 'motorbike', lat: 5.605, lng: -0.19, age_s: 45, stale: false },
    leg: { to: 'pickup', distance_km: 1.1, duration_s: 240, basis: 'road route' }, route: [[5.605, -0.19], [5.6037, -0.187]],
  }

  it('fetches nothing until the owner opens "Rider on the way", then shows shop pin, rider and ETA', async () => {
    const calls = trackWith(HEADING)
    renderPanel([DOOR_TO_DOOR_ORDER])
    const toggle = await screen.findByRole('button', { name: /Rider on the way/ })
    await new Promise((r) => setTimeout(r, 60))
    expect(calls).toHaveLength(0)
    expect(screen.queryByTestId('track-map')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    const map = await screen.findByTestId('track-map')
    expect(map).toHaveAttribute('data-route-points', '2')
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('data-kind')).filter(Boolean).sort()).toEqual(['pickup', 'rider'])
    expect(screen.getAllByText(/Kojo/).length).toBeGreaterThan(0)
    expect(screen.getByText(/About 4 min/)).toBeInTheDocument()
  })

  it('shows a plain line and no map once the rider has collected the order', async () => {
    trackWith({ stage: 'picked_up', rider: null, leg: null, route: null })
    renderPanel([DOOR_TO_DOOR_ORDER])
    fireEvent.click(await screen.findByRole('button', { name: /Rider on the way/ }))
    expect(await screen.findByText('The rider has collected the order.')).toBeInTheDocument()
    expect(screen.queryByTestId('track-map')).not.toBeInTheDocument()
  })

  it('says so when no rider has been assigned', async () => {
    trackWith({ stage: 'not_assigned' })
    renderPanel([DOOR_TO_DOOR_ORDER])
    fireEvent.click(await screen.findByRole('button', { name: /Rider on the way/ }))
    expect(await screen.findByText('A rider has not been assigned yet.')).toBeInTheDocument()
    expect(screen.queryByTestId('track-map')).not.toBeInTheDocument()
  })

  it('has no disclosure for store pickup or delivered orders', async () => {
    renderPanel([
      { ...DOOR_TO_DOOR_ORDER, id: 8, delivery_method: 'store_pickup' },
      { ...DOOR_TO_DOOR_ORDER, id: 9, delivery_status: 'delivered' },
    ])
    await screen.findByText(/Order #8/)
    expect(screen.queryByRole('button', { name: /Rider on the way/ })).not.toBeInTheDocument()
  })

  it("never puts the customer's address in the disclosure or its markers", async () => {
    trackWith({ ...HEADING, drop: { lat: 5.6, lng: -0.17, address: 'Bantama, Kumasi' } })
    renderPanel([DOOR_TO_DOOR_ORDER])
    fireEvent.click(await screen.findByRole('button', { name: /Rider on the way/ }))
    const map = await screen.findByTestId('track-map')
    const region = map.closest('[data-testid="rider-disclosure"]')
    expect(region).not.toBeNull()
    expect(region.textContent).not.toMatch(/Bantama|Kumasi|customer|drop/i)
    expect(screen.queryAllByRole('button').some((b) => b.getAttribute('data-kind') === 'drop')).toBe(false)
  })
})
