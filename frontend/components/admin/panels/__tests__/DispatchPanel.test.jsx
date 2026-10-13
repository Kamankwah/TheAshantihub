import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import DispatchPanel from '../DispatchPanel.jsx'

// Replace the global stub so the props DispatchPanel passes can be asserted.
vi.mock('../../../DeliveryRouteMap.jsx', () => ({
  default: ({ route, rider }) =>
    createElement('div', {
      'data-testid': 'route-map',
      'data-has-route-prop': route === undefined ? 'no' : 'yes',
      'data-route-points': route ? route.length : 0,
      'data-rider': rider ? `${rider.lat},${rider.lng}` : '',
    }),
}))

const API = 'http://localhost:8000'
const DELIVERY = {
  id: 3, order_id: 11, status: 'picked_up', customer_name: 'Yaw Mensah', delivery_phone: '0200000201',
  delivery_address: 'Bantama, Kumasi', delivery_lat: 5.6, delivery_lng: -0.17,
  pickups: [{ business_name: 'Akosua Ntoma', phone: '0200000111', lat: 5.6037, lng: -0.187, items: ['Stole'] }],
}
function mount(mapHits) {
  server.use(
    http.get(`${API}/api/orders/dispatch/`, () => HttpResponse.json({ count: 1, next: null, previous: null, results: [DELIVERY] })),
    http.get(`${API}/api/orders/dispatch/:id/map/`, ({ params }) => {
      mapHits.push(params.id)
      return HttpResponse.json({
        stage: 'picked_up', pickup: { lat: 5.6037, lng: -0.187 }, drop: { lat: 5.6, lng: -0.17 },
        rider: { lat: 5.602, lng: -0.18, age_s: 20, stale: false }, leg: null, route: [[5.602, -0.18], [5.601, -0.175], [5.6, -0.17]],
      })
    }),
  )
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DispatchPanel /></QueryClientProvider>)
}

describe('DispatchPanel route map', () => {
  it('fetches the map only when shown, then passes the road route and rider fix through', async () => {
    const hits = []
    mount(hits)
    const show = await screen.findByRole('button', { name: /Show route map/ })
    await new Promise((r) => setTimeout(r, 60))
    expect(hits).toHaveLength(0)
    fireEvent.click(show)
    const map = await screen.findByTestId('route-map')
    await vi.waitFor(() => expect(screen.getByTestId('route-map')).toHaveAttribute('data-route-points', '3'))
    expect(map).toHaveAttribute('data-has-route-prop', 'yes')
    expect(screen.getByTestId('route-map')).toHaveAttribute('data-rider', '5.602,-0.18')
    expect(hits).toEqual(['3'])
  })
})
