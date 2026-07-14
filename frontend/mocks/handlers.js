import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('http://localhost:8000/api/listings/categories/', () => {
    return HttpResponse.json([
      { id: 1, slug: 'hotels', icon: '🏨', label: 'Hotels', color: '#000080', kind: 'service' },
      { id: 2, slug: 'food', icon: '🍲', label: 'Food', color: '#CC0000', kind: 'product' },
    ])
  }),
  http.get('http://localhost:8000/api/listings/zones/', () => {
    return HttpResponse.json([
      { id: 1, name: 'Manhyia' },
      { id: 2, name: 'Adum' },
    ])
  }),
  http.get('http://localhost:8000/api/listings/:id/related/', () => {
    return HttpResponse.json([])
  }),
  // Cart & checkout (docs/BUSINESS_EVENTS_ROADMAP.md Phase 4) — default
  // handlers, overridden per-test via server.use() where a specific cart
  // state/response is needed.
  http.get('http://localhost:8000/api/cart/', () => {
    return HttpResponse.json({ id: 1, items: [], total: '0.00', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' })
  }),
  http.post('http://localhost:8000/api/cart/items/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json(
      { id: 1, listing: body.listing, listing_name: 'Item', quantity: body.quantity ?? 1, unit_price_snapshot: '0.00', line_total: '0.00', added_at: '2026-07-01T00:00:00Z' },
      { status: 201 },
    )
  }),
  http.patch('http://localhost:8000/api/cart/items/:id/', async ({ params, request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: Number(params.id), listing: 1, listing_name: 'Item', quantity: body.quantity, unit_price_snapshot: '0.00', line_total: '0.00', added_at: '2026-07-01T00:00:00Z' })
  }),
  http.delete('http://localhost:8000/api/cart/items/:id/', () => {
    return new HttpResponse(null, { status: 204 })
  }),
  http.post('http://localhost:8000/api/orders/checkout/', () => {
    return HttpResponse.json(
      { id: 1, status: 'paid', total_amount: '0.00', placed_at: '2026-07-01T00:00:00Z', items: [] },
      { status: 201 },
    )
  }),
  http.get('http://localhost:8000/api/orders/', () => {
    return HttpResponse.json([])
  }),
  // Events (docs/BUSINESS_EVENTS_ROADMAP.md Phase 6) — default handlers,
  // overridden per-test via server.use() where a specific events state/
  // response is needed.
  http.get('http://localhost:8000/api/events/', () => {
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
  }),
  http.get('http://localhost:8000/api/events/mine/', () => {
    return HttpResponse.json([])
  }),
]
