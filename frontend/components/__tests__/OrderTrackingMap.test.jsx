import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
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
    mount(<OrderTrackingMap orderId={7} assignmentStatus={null} />)
    expect(screen.getByText('Finding a rider')).toBeInTheDocument()
    expect(screen.queryByTestId('track-map')).not.toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 60))
    expect(calls).toHaveLength(0)
  })

  it.each(['assigned', 'accepted', 'at_pickup'])('shows text only while the rider heads to the shop (%s)', async (status) => {
    const calls = track(PICKED_UP)
    mount(<OrderTrackingMap orderId={7} assignmentStatus={status} />)
    expect(screen.getByText('A rider is heading to the shop')).toBeInTheDocument()
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
    const { container } = mount(<OrderTrackingMap orderId={7} assignmentStatus="picked_up" />)
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
    mount(<OrderTrackingMap orderId={7} assignmentStatus="at_customer" />)
    await screen.findByTestId('track-map')
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('data-kind'))).toContain('stale')
    expect(screen.getByText(/Last location 10 min ago/)).toBeInTheDocument()
  })

  it('shows a plain line, not an empty map, when the server has no rider fix', async () => {
    track({ stage: 'picked_up', drop: { lat: 5.6, lng: -0.17 }, rider: null, leg: null, route: null })
    mount(<OrderTrackingMap orderId={7} assignmentStatus="picked_up" />)
    expect(await screen.findByText(/location is not available/i)).toBeInTheDocument()
    expect(screen.queryByTestId('track-map')).not.toBeInTheDocument()
  })
})
