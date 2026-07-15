import { http, HttpResponse } from 'msw'

export const handlers = [
  // Listings search/browse (docs/UI_MODERNIZATION_ROADMAP.md Phase D) — a
  // default empty-page handler. AshantiHub's `useListings(filters)` call
  // fires unconditionally on mount (not gated by which page/tab is active),
  // so any full-app render (e.g. App.routing.test.jsx) needs this to exist
  // even when the test itself doesn't care about listings content.
  http.get('http://localhost:8000/api/listings/', () => {
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
  }),
  // Active hero-media submissions (docs/BUSINESS_EVENTS_ROADMAP.md Phase 3)
  // — HeroCarousel's useActiveHero() fires whenever the Business tab mounts;
  // default to none active so it renders nothing, matching its documented
  // empty-state behavior.
  http.get('http://localhost:8000/api/hero/active/', () => {
    return HttpResponse.json([])
  }),
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
  // Site settings / footer content (docs/UI_MODERNIZATION_ROADMAP.md Phase B)
  // — default handlers, overridden per-test via server.use() where a
  // specific settings state/response is needed.
  http.get('http://localhost:8000/api/core/site-settings/', () => {
    return HttpResponse.json({
      contact_email: '', contact_phone: '', contact_address: '',
      facebook_url: '', instagram_url: '', linkedin_url: '', twitter_url: '',
      tiktok_url: 'https://tiktok.com/@ashantihub', youtube_url: 'https://youtube.com/@ashantihub',
      whatsapp_number: '233244000000', support_hours: 'Mon–Sat, 8:00am – 8:00pm GMT',
      warranty_returns_policy: '', service_dispute_policy: '',
    })
  }),
  http.patch('http://localhost:8000/api/core/site-settings/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({
      contact_email: '', contact_phone: '', contact_address: '',
      facebook_url: '', instagram_url: '', linkedin_url: '', twitter_url: '',
      tiktok_url: '', youtube_url: '', whatsapp_number: '', support_hours: '',
      warranty_returns_policy: '', service_dispute_policy: '',
      ...body,
    })
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
  // RSVP / attendees (docs/BUSINESS_EVENTS_ROADMAP.md Phase 7) — default
  // handlers, overridden per-test via server.use() where a specific
  // RSVP/capacity/attendee-list response is needed.
  http.post('http://localhost:8000/api/events/:id/rsvp/', ({ params }) => {
    return HttpResponse.json({ event: Number(params.id), status: 'going', going_count: 1 }, { status: 201 })
  }),
  http.delete('http://localhost:8000/api/events/:id/rsvp/', () => {
    return new HttpResponse(null, { status: 204 })
  }),
  http.get('http://localhost:8000/api/events/:id/rsvps/', () => {
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
  }),
  // Reviews & Q&A (reviews/qa apps, frontend Phase 3) — default handlers,
  // overridden per-test via server.use() where a specific reviews/Q&A/
  // eligibility/moderation response is needed. Review list endpoints are all
  // paginated with top-level avg_rating/review_count alongside the usual
  // DRF envelope.
  http.get('http://localhost:8000/api/reviews/listing/:id/', () => {
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [], avg_rating: null, review_count: 0 })
  }),
  http.get('http://localhost:8000/api/reviews/event/:id/', () => {
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [], avg_rating: null, review_count: 0 })
  }),
  http.get('http://localhost:8000/api/reviews/seller/:id/', () => {
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [], avg_rating: null, review_count: 0 })
  }),
  http.get('http://localhost:8000/api/reviews/organizer/:kind/:id/', () => {
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [], avg_rating: null, review_count: 0 })
  }),
  http.get('http://localhost:8000/api/reviews/eligibility/', () => {
    return HttpResponse.json({ eligible: false, already_reviewed: false })
  }),
  http.post('http://localhost:8000/api/reviews/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json(
      { id: 1, rating: body.rating, comment: body.comment || '', verified: true, author_name: 'Customer', created_at: '2026-07-01T00:00:00Z' },
      { status: 201 },
    )
  }),
  http.get('http://localhost:8000/api/reviews/moderation/', () => {
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
  }),
  http.post('http://localhost:8000/api/reviews/moderation/:id/hide/', () => {
    return HttpResponse.json({ id: 1, status: 'hidden' })
  }),
  http.post('http://localhost:8000/api/reviews/moderation/:id/unhide/', () => {
    return HttpResponse.json({ id: 1, status: 'published' })
  }),
  http.get('http://localhost:8000/api/qa/questions/listing/:id/', () => {
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
  }),
  http.get('http://localhost:8000/api/qa/questions/event/:id/', () => {
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
  }),
  http.post('http://localhost:8000/api/qa/questions/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: 1, question_text: body.question_text, answer_text: null, answered_at: null }, { status: 201 })
  }),
  http.post('http://localhost:8000/api/qa/questions/:id/answer/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: 1, answer_text: body.answer_text, answered_at: '2026-07-01T00:00:00Z' })
  }),
  // Public contact form + staff contact-messages queue (frontend Phase —
  // Contact page rebuild). Default handlers, overridden per-test where a
  // specific submit-error/queue-content response is needed.
  http.post('http://localhost:8000/api/core/contact/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json(
      { id: 1, category: body.category, name: body.name, email: body.email, phone: body.phone || '', subject: body.subject, message: body.message, status: 'new', resolved_by_name: null, resolved_at: null, created_at: '2026-07-01T00:00:00Z' },
      { status: 201 },
    )
  }),
  http.get('http://localhost:8000/api/core/contact-messages/', () => {
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
  }),
  http.post('http://localhost:8000/api/core/contact-messages/:id/read/', () => {
    return HttpResponse.json({ id: 1, status: 'read' })
  }),
  http.post('http://localhost:8000/api/core/contact-messages/:id/resolve/', () => {
    return HttpResponse.json({ id: 1, status: 'resolved' })
  }),
]
