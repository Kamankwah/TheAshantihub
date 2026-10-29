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

describe('DeliveriesPanel store pickup', () => {
  it('a store-pickup order says the customer collects at the AshantiHub office', async () => {
    renderPanel([{ ...DOOR_TO_DOOR_ORDER, delivery_method: 'store_pickup', delivery_address: '', collection_code: '482913' }])
    expect(await screen.findByText('The customer collects this order at the AshantiHub pickup office, not at your shop.')).toBeInTheDocument()
    expect(screen.queryByText(/482913/)).not.toBeInTheDocument()
  })

  it('a door-to-door order does not carry the pickup notice', async () => {
    renderPanel([DOOR_TO_DOOR_ORDER])
    await screen.findByText(/Bantama, Kumasi/)
    expect(screen.queryByText(/pickup office/)).not.toBeInTheDocument()
  })
})

describe('DeliveriesPanel rider tracking (vendor)', () => {
  const API = 'http://localhost:8000'
  const trackWith = (payload) => {
    const calls = []
    server.use(http.get(`${API}/api/orders/owner/:id/tracking/`, () => { calls.push(1); return HttpResponse.json(payload) }))
    return calls
  }
  const HEADING_ORDER = { ...DOOR_TO_DOOR_ORDER, rider_heading_here: true }
  const HEADING = {
    stage: 'accepted', pickup: { lat: 5.6037, lng: -0.187, name: 'Akosua Ntoma' },
    rider: { first_name: 'Kojo', vehicle_type: 'motorbike', lat: 5.605, lng: -0.19, age_s: 45, stale: false },
    leg: { to: 'pickup', distance_km: 1.1, duration_s: 240, basis: 'road route' }, route: [[5.605, -0.19], [5.6037, -0.187]],
  }

  it('fetches nothing until the owner opens "Rider on the way", then shows shop pin, rider and ETA', async () => {
    const calls = trackWith(HEADING)
    renderPanel([HEADING_ORDER])
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
    renderPanel([HEADING_ORDER])
    fireEvent.click(await screen.findByRole('button', { name: /Rider on the way/ }))
    expect(await screen.findByText('The rider has collected the order.')).toBeInTheDocument()
    expect(screen.queryByTestId('track-map')).not.toBeInTheDocument()
  })

  it('does not claim collection when the rider is still heading here but has no location', async () => {
    trackWith({ stage: 'accepted', pickup: { lat: 5.6037, lng: -0.187, name: 'Akosua Ntoma' }, rider: null, leg: null, route: null })
    renderPanel([HEADING_ORDER])
    fireEvent.click(await screen.findByRole('button', { name: /Rider on the way/ }))
    expect(await screen.findByText("The rider's location is not available right now.")).toBeInTheDocument()
    expect(screen.queryByText(/collected/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('track-map')).not.toBeInTheDocument()
  })

  it('explains a missing shop pin and lists only the pins drawn', async () => {
    trackWith({ ...HEADING, pickup: null, leg: null, route: null })
    renderPanel([HEADING_ORDER])
    fireEvent.click(await screen.findByRole('button', { name: /Rider on the way/ }))
    expect(await screen.findByText("Your shop has no map pin, so the arrival time can't be shown.")).toBeInTheDocument()
    expect(screen.queryByText(/Gold pin/)).not.toBeInTheDocument()
    expect(screen.getByText(/Dark pin: rider/)).toBeInTheDocument()
    expect(screen.queryByText(/About \d+ min/)).not.toBeInTheDocument()
  })

  it('says the rider is finishing another delivery, with no map, when the server marks the rider busy', async () => {
    trackWith({ stage: 'accepted', pickup: { lat: 5.6037, lng: -0.187, name: 'Akosua Ntoma' }, rider: null, leg: null, route: null, rider_busy: true })
    renderPanel([HEADING_ORDER])
    fireEvent.click(await screen.findByRole('button', { name: /Rider on the way/ }))
    expect(await screen.findByText('The rider is finishing another delivery first.')).toBeInTheDocument()
    expect(screen.queryByTestId('track-map')).not.toBeInTheDocument()
  })

  it('uses neutral copy for a failed delivery', async () => {
    trackWith({ stage: 'failed', rider: null, leg: null, route: null })
    renderPanel([HEADING_ORDER])
    fireEvent.click(await screen.findByRole('button', { name: /Rider on the way/ }))
    expect(await screen.findByText('This delivery did not go ahead.')).toBeInTheDocument()
  })

  it('says so when no rider has been assigned', async () => {
    trackWith({ stage: 'not_assigned' })
    renderPanel([HEADING_ORDER])
    fireEvent.click(await screen.findByRole('button', { name: /Rider on the way/ }))
    expect(await screen.findByText('A rider has not been assigned yet.')).toBeInTheDocument()
    expect(screen.queryByTestId('track-map')).not.toBeInTheDocument()
  })

  it('has no disclosure unless a rider is heading to this shop', async () => {
    renderPanel([
      { ...HEADING_ORDER, id: 8, delivery_method: 'store_pickup' },
      { ...DOOR_TO_DOOR_ORDER, id: 9, rider_heading_here: false },
      { ...DOOR_TO_DOOR_ORDER, id: 10 },
    ])
    await screen.findByText(/Order #8/)
    expect(screen.queryByRole('button', { name: /Rider on the way/ })).not.toBeInTheDocument()
  })

  it("never puts the customer's address in the disclosure or its markers", async () => {
    trackWith({ ...HEADING, drop: { lat: 5.6, lng: -0.17, address: 'Bantama, Kumasi' } })
    renderPanel([HEADING_ORDER])
    fireEvent.click(await screen.findByRole('button', { name: /Rider on the way/ }))
    const map = await screen.findByTestId('track-map')
    const region = map.closest('[data-testid="rider-disclosure"]')
    expect(region).not.toBeNull()
    expect(region.textContent).not.toMatch(/Bantama|Kumasi|customer|drop/i)
    expect(screen.queryAllByRole('button').some((b) => b.getAttribute('data-kind') === 'drop')).toBe(false)
  })

  it('says the rider is at another shop first, with no map', async () => {
    trackWith({ stage: 'accepted', pickup: { lat: 5.6037, lng: -0.187, name: 'Akosua Ntoma' }, stop: { status: 'pending', planned_arrival: null, late: false }, rider: null, leg: null, route: null, rider_elsewhere: true })
    renderPanel([HEADING_ORDER])
    fireEvent.click(await screen.findByRole('button', { name: /Rider on the way/ }))
    expect(await screen.findByText('The rider is collecting from another shop first.')).toBeInTheDocument()
    expect(screen.queryByTestId('track-map')).not.toBeInTheDocument()
  })

  it('says its items are collected once its own stop is done, even while the rider is at the next shop', async () => {
    trackWith({ stage: 'accepted', pickup: null, stop: { status: 'collected', planned_arrival: null, late: false }, rider: null, leg: null, route: null, rider_elsewhere: false })
    renderPanel([HEADING_ORDER])
    fireEvent.click(await screen.findByRole('button', { name: /Rider on the way/ }))
    expect(await screen.findByText('The rider has collected your items.')).toBeInTheDocument()
  })

  it('says the rider is running late on the map when the stop is late', async () => {
    trackWith({ ...HEADING, stop: { status: 'pending', planned_arrival: null, late: true }, rider_elsewhere: false })
    renderPanel([HEADING_ORDER])
    fireEvent.click(await screen.findByRole('button', { name: /Rider on the way/ }))
    expect(await screen.findByText('The rider is running late.')).toBeInTheDocument()
  })
})

describe('DeliveriesPanel pickup code (vendor)', () => {
  const DROP_CODE = '2468'

  it('shows the pickup code large, with who to give it to, when the server sends one', async () => {
    renderPanel([{ ...DOOR_TO_DOOR_ORDER, pickup_code: '4729', rider_heading_here: false }])
    const box = await screen.findByTestId('pickup-code-box')
    expect(box).toHaveTextContent('Pickup code')
    expect(screen.getByLabelText('Pickup code 4 7 2 9')).toBeInTheDocument()
    expect(box).toHaveTextContent('Read this to the rider when they collect order #7.')
    expect(box).toHaveTextContent('Only give it to the rider who is at your shop.')
  })

  it('renders nothing when the pickup code is null or missing', async () => {
    renderPanel([{ ...DOOR_TO_DOOR_ORDER, pickup_code: null }])
    await screen.findByText(/Bantama, Kumasi/)
    expect(screen.queryByTestId('pickup-code-box')).not.toBeInTheDocument()
    expect(screen.queryByText(/Pickup code/)).not.toBeInTheDocument()
  })

  it('never shows a delivery code, even if one slipped into the payload', async () => {
    const { container } = renderPanel([{ ...DOOR_TO_DOOR_ORDER, pickup_code: '4729', delivery_code: DROP_CODE, drop_code: DROP_CODE }])
    await screen.findByTestId('pickup-code-box')
    expect(container.textContent).not.toContain(DROP_CODE)
    expect(screen.queryByText(/Delivery code/i)).not.toBeInTheDocument()
  })

  it('tells a later shop when the rider should arrive, with its own code and no map yet', async () => {
    renderPanel([{ ...DOOR_TO_DOOR_ORDER, pickup_code: '4821', pickup_eta: '2026-10-14T14:35:00Z', rider_heading_here: false }])
    expect(await screen.findByText(/Rider arrives about \d{2}:\d{2}/)).toBeInTheDocument()
    expect(screen.getByLabelText('Pickup code 4 8 2 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Rider on the way/ })).not.toBeInTheDocument()
  })

  it('says running late, not a passed time, when the planned arrival has gone by', async () => {
    renderPanel([{ ...DOOR_TO_DOOR_ORDER, pickup_eta: '2026-10-14T14:35:00Z', pickup_eta_late: true }])
    expect(await screen.findByText(/The rider is running late/)).toBeInTheDocument()
    expect(screen.queryByText(/Rider arrives about/)).not.toBeInTheDocument()
  })

  it("shows the rider's report when this shop could not hand over, with no rider details", async () => {
    renderPanel([{ ...DOOR_TO_DOOR_ORDER, pickup_status: 'skipped', rider_report: { at: '2026-10-14T14:35:00Z', text: 'Rider reported at your shop at 14:35: Door was locked' } }])
    expect(await screen.findByText('Rider reported at your shop at 14:35: Door was locked')).toBeInTheDocument()
    expect(screen.queryByText(/\+233/)).not.toBeInTheDocument()
  })



})
