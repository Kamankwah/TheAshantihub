import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import OrderTrackingMap from '../OrderTrackingMap.jsx'

const API = 'http://localhost:8000'
const mount = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

function track(payload) {
  const calls = []
  server.use(http.get(`${API}/api/orders/:id/tracking/`, () => { calls.push(1); return HttpResponse.json(payload) }))
  return calls
}

const PICKED_UP = {
  stage: 'picked_up', drop: { lat: 5.6, lng: -0.17 },
  rider: { first_name: 'Kojo', vehicle_type: 'motorbike', lat: 5.602, lng: -0.18, age_s: 20, stale: false },
  leg: { to: 'drop', distance_km: 1.4, duration_s: 300, basis: 'road route' }, route: [[5.602, -0.18], [5.6, -0.17]],
}

describe('OrderTrackingMap (customer)', () => {
  it('says a rider is being found, with no map and no request, when nothing is assigned', async () => {
    const calls = track(PICKED_UP)
    mount(<OrderTrackingMap orderId={7} assignmentStatus={null} deliveryStatus="processing" />)
    expect(screen.getByText('Finding a rider')).toBeInTheDocument()
    expect(screen.queryByTestId('track-map')).not.toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 60))
    expect(calls).toHaveLength(0)
  })

  it.each([
    ['assigned', 'A rider has been assigned.'],
    ['accepted', 'A rider is heading to the shop.'],
    ['at_pickup', 'The rider is at the shop.'],
  ])('shows text only before pickup, worded by status (%s)', async (status, text) => {
    const calls = track(PICKED_UP)
    mount(<OrderTrackingMap orderId={7} assignmentStatus={status} deliveryStatus="processing" />)
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.queryByTestId('track-map')).not.toBeInTheDocument()
    expect(screen.queryByText(/Kojo/)).not.toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 60))
    expect(calls).toHaveLength(0)
  })

  it.each(['delivered', 'confirmed', 'failed'])('shows no map once the order is %s', async (status) => {
    const calls = track(PICKED_UP)
    const { container } = mount(<OrderTrackingMap orderId={7} assignmentStatus={status} />)
    await new Promise((r) => setTimeout(r, 60))
    expect(container).toBeEmptyDOMElement()
    expect(calls).toHaveLength(0)
  })

  it('shows the map, the rider first name and vehicle, and the ETA after pickup', async () => {
    const calls = track({ ...PICKED_UP, rider: { ...PICKED_UP.rider, last_name: 'Mensah', phone: '0200000999' } })
    const { container } = mount(<OrderTrackingMap orderId={7} assignmentStatus="picked_up" deliveryStatus="out_for_delivery" />)
    expect(await screen.findByTestId('track-map')).toHaveAttribute('data-route-points', '2')
    expect(screen.getAllByText(/Kojo/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/motorbike/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/About 5 min/)).toBeInTheDocument()
    expect(calls.length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('data-kind')).sort()).toEqual(['drop', 'rider'])
    expect(container.textContent).not.toMatch(/Mensah|0200000999/)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText(/call|message|whatsapp/i)).not.toBeInTheDocument()
  })

  it('marks a stale rider fix and says so', async () => {
    track({ ...PICKED_UP, rider: { ...PICKED_UP.rider, age_s: 600, stale: true } })
    mount(<OrderTrackingMap orderId={7} assignmentStatus="at_customer" deliveryStatus="out_for_delivery" />)
    await screen.findByTestId('track-map')
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('data-kind'))).toContain('stale')
    expect(screen.getByText(/Last location 10 min ago/)).toBeInTheDocument()
  })

  it('shows a plain line, not an empty map, when the server has no rider fix', async () => {
    track({ stage: 'picked_up', drop: { lat: 5.6, lng: -0.17 }, rider: null, leg: null, route: null })
    mount(<OrderTrackingMap orderId={7} assignmentStatus="picked_up" deliveryStatus="out_for_delivery" />)
    expect(await screen.findByText(/location is not available/i)).toBeInTheDocument()
    expect(screen.queryByTestId('track-map')).not.toBeInTheDocument()
  })

  it('explains a missing delivery pin and lists only the pins drawn', async () => {
    track({ ...PICKED_UP, drop: null, leg: null, route: null })
    mount(<OrderTrackingMap orderId={7} assignmentStatus="picked_up" deliveryStatus="out_for_delivery" />)
    expect(await screen.findByText("Your address has no map pin, so the route and arrival time can't be shown.")).toBeInTheDocument()
    expect(screen.getByText('Dark pin: rider.')).toBeInTheDocument()
    expect(screen.queryByText(/Green pin/)).not.toBeInTheDocument()
    expect(screen.queryByText(/About \d+ min/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('data-kind'))).toEqual(['rider'])
  })

  it('says the rider is finishing another delivery, with no map, when the server marks the rider busy', async () => {
    track({ stage: 'picked_up', drop: { lat: 5.6, lng: -0.17 }, rider: null, leg: null, route: null, rider_busy: true })
    mount(<OrderTrackingMap orderId={7} assignmentStatus="picked_up" deliveryStatus="out_for_delivery" />)
    expect(await screen.findByText('The rider is finishing another delivery first.')).toBeInTheDocument()
    expect(screen.queryByTestId('track-map')).not.toBeInTheDocument()
    expect(screen.queryByText(/location is not available/i)).not.toBeInTheDocument()
  })

  it('shows the pre-pickup lines only while the order is processing', async () => {
    for (const [assignment, text] of [[null, 'Finding a rider'], ['accepted', 'A rider is heading to the shop.']]) {
      const { container, unmount } = mount(<OrderTrackingMap orderId={7} assignmentStatus={assignment} deliveryStatus="delivered" />)
      expect(container).toBeEmptyDOMElement()
      expect(screen.queryByText(text)).not.toBeInTheDocument()
      unmount()
    }
  })

  it('shows an honest error instead of loading forever', async () => {
    server.use(http.get(`${API}/api/orders/:id/tracking/`, () => HttpResponse.json({}, { status: 500 })))
    mount(<OrderTrackingMap orderId={7} assignmentStatus="picked_up" deliveryStatus="out_for_delivery" />)
    expect(await screen.findByText(/Could not load the live map/)).toBeInTheDocument()
  })

  it('drops the map and refreshes the orders when the delivery moves on while watching', async () => {
    track({ stage: 'delivered', rider: null, leg: null, route: null })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['orders'], [])
    const spy = []
    const orig = client.invalidateQueries.bind(client)
    client.invalidateQueries = (f) => { spy.push(f); return orig(f) }
    const { container } = render(<QueryClientProvider client={client}><OrderTrackingMap orderId={7} assignmentStatus="at_customer" deliveryStatus="out_for_delivery" /></QueryClientProvider>)
    await waitFor(() => expect(spy.some((f) => JSON.stringify(f.queryKey) === '["orders"]')).toBe(true))
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText(/location is not available/i)).not.toBeInTheDocument()
  })
})

describe('OrderTrackingMap with several shops', () => {
  it('counts the shops before the last pickup, with no map', async () => {
    const calls = track(PICKED_UP)
    mount(<OrderTrackingMap orderId={7} assignmentStatus="accepted" deliveryStatus="processing" stops={{ total: 3, done: 1, skipped: 0 }} />)
    expect(screen.getByText('Collecting from 3 shops: 1 done.')).toBeInTheDocument()
    expect(screen.queryByTestId('track-map')).not.toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 60))
    expect(calls).toHaveLength(0)
  })

  it('says a shop that could not hand over is for Support to review, without promising a refund, before and after pickup', async () => {
    track(PICKED_UP)
    const { rerender } = mount(<OrderTrackingMap orderId={7} assignmentStatus="accepted" deliveryStatus="processing" stops={{ total: 3, done: 1, skipped: 1 }} />)
    expect(screen.getByText('Collecting from 3 shops: 1 done, 1 could not hand over.')).toBeInTheDocument()
    expect(screen.getByText(/will not arrive\. AshantiHub Support will review a refund and be in touch/)).toBeInTheDocument()
    expect(screen.queryByText(/is refunded|are refunded/)).not.toBeInTheDocument()
    rerender(<QueryClientProvider client={new QueryClient()}><OrderTrackingMap orderId={7} assignmentStatus="picked_up" deliveryStatus="out_for_delivery" stops={{ total: 3, done: 2, skipped: 1 }} /></QueryClientProvider>)
    expect(screen.getByText(/AshantiHub Support will review a refund/)).toBeInTheDocument()
  })

  it('adds nothing for a single shop', () => {
    mount(<OrderTrackingMap orderId={7} assignmentStatus="accepted" deliveryStatus="processing" stops={null} />)
    expect(screen.queryByText(/Collecting from/)).not.toBeInTheDocument()
  })
})
