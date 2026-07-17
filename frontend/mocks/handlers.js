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
  // The signed-in customer's full self-service profile (useMyCustomerProfile,
  // AccountProfileCard/SettingsTab) — default handler, overridden per-test
  // where a specific address/gender/secondary-email state is needed.
  http.get('http://localhost:8000/api/accounts/customers/me/profile/', () => {
    return HttpResponse.json({
      id: 1, full_name: 'Ama Boateng', avatar: null, email: null, phone: null,
      address: null, gender: null, date_of_birth: null,
      secondary_email: null, secondary_email_verified: false,
      secondary_phone: null, secondary_phone_verified: false,
      email_notifications_enabled: true, sms_notifications_enabled: true,
    })
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
  // Event edit + renew (business item 3) — default handlers.
  http.patch('http://localhost:8000/api/events/mine/:id/', async ({ params, request }) => {
    return HttpResponse.json({ id: Number(params.id), status: 'pending', ...(await request.json()) })
  }),
  http.post('http://localhost:8000/api/events/:id/renew/', () => {
    return HttpResponse.json({ id: 1, status: 'approved' })
  }),
  // The signed-in customer's own purchased tickets (useMyTickets) — default
  // empty-array handler, overridden per-test where specific ticket rows are
  // needed (e.g. UserPanel.test.jsx's Account Overview/My Tickets tabs).
  http.get('http://localhost:8000/api/events/tickets/mine/', () => {
    return HttpResponse.json([])
  }),
  // Event pricing tiers (event pricing tiers work) — default handler
  // matching the 5 seeded backend rows, overridden per-test where a
  // different price/proposal state is needed.
  http.get('http://localhost:8000/api/events/pricing-tiers/', () => {
    return HttpResponse.json([
      { id: 1, duration_days: 7, live_price: '20.00' },
      { id: 2, duration_days: 15, live_price: '30.00' },
      { id: 3, duration_days: 30, live_price: '50.00' },
      { id: 4, duration_days: 60, live_price: '90.00' },
      { id: 5, duration_days: 90, live_price: '120.00' },
    ])
  }),
  http.get('http://localhost:8000/api/events/pricing-tiers/manage/', () => {
    return HttpResponse.json([
      { id: 1, duration_days: 7, live_price: '20.00', pending_price: null, proposed_by: null, proposed_by_name: null, proposed_at: null },
      { id: 2, duration_days: 15, live_price: '30.00', pending_price: null, proposed_by: null, proposed_by_name: null, proposed_at: null },
      { id: 3, duration_days: 30, live_price: '50.00', pending_price: null, proposed_by: null, proposed_by_name: null, proposed_at: null },
      { id: 4, duration_days: 60, live_price: '90.00', pending_price: null, proposed_by: null, proposed_by_name: null, proposed_at: null },
      { id: 5, duration_days: 90, live_price: '120.00', pending_price: null, proposed_by: null, proposed_by_name: null, proposed_at: null },
    ])
  }),
  http.get('http://localhost:8000/api/events/moderation/pending/', () => {
    return HttpResponse.json([])
  }),
  // Event moderation detail (staff dashboard review tools) — default handler,
  // overridden per-test where a specific event's full detail is asserted.
  http.get('http://localhost:8000/api/events/moderation/:id/', ({ params }) => {
    return HttpResponse.json({ id: Number(params.id), name: 'Event', description: '', category: null, zone: null, media: [] })
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
  // Business Command Center analytics (frontend dashboard redesign) — the
  // Analytics tab is the default landing tab and fires the owner's transaction
  // ledger + credit score on mount to derive its charts. Default to empty/none
  // so any dashboard render is clean; overridden per-test via server.use()
  // where specific analytics data is asserted.
  http.get('http://localhost:8000/api/billing/transactions/mine/', () => {
    return HttpResponse.json([])
  }),
  http.get('http://localhost:8000/api/credit/scores/me/', () => {
    return HttpResponse.json({ score: null, base_score: null, manual_adjustment: 0, adjustment_reason: '', grade: null, grade_label: null, loan_eligible: false, factors: {}, computed_at: null })
  }),
  // Credit management (credit app, item 16) — default handlers, overridden
  // per-test as needed.
  http.get('http://localhost:8000/api/credit/partners/', () => {
    return HttpResponse.json([])
  }),
  http.post('http://localhost:8000/api/credit/partners/', async ({ request }) => {
    return HttpResponse.json({ id: 99, ...(await request.json()) }, { status: 201 })
  }),
  http.patch('http://localhost:8000/api/credit/partners/:id/', async ({ params, request }) => {
    return HttpResponse.json({ id: Number(params.id), ...(await request.json()) })
  }),
  http.get('http://localhost:8000/api/credit/scores/', () => {
    return HttpResponse.json([])
  }),
  http.post('http://localhost:8000/api/credit/scores/:id/adjust/', ({ params }) => {
    return HttpResponse.json({ business_owner: Number(params.id), score: 640, base_score: 600, manual_adjustment: 40 })
  }),
  http.get('http://localhost:8000/api/credit/loans/', () => {
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
  }),
  http.post('http://localhost:8000/api/credit/loans/submit/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: 5, status: 'submitted', score_at_application: 620, lending_partner_name: null, ...body }, { status: 201 })
  }),
  http.post('http://localhost:8000/api/credit/loans/:id/review/', ({ params }) => {
    return HttpResponse.json({ id: Number(params.id), status: 'approved' })
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
  http.post('http://localhost:8000/api/reviews/moderation/:id/approve/', () => {
    return HttpResponse.json({ id: 1, status: 'published' })
  }),
  http.post('http://localhost:8000/api/reviews/moderation/:id/hide/', () => {
    return HttpResponse.json({ id: 1, status: 'hidden' })
  }),
  http.post('http://localhost:8000/api/reviews/moderation/:id/re-review/', () => {
    return HttpResponse.json({ id: 1, status: 'pending' })
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
  // Admin OverviewPanel (system-admin-dashboard visual-system rebuild) fires
  // several staff-only queue/count hooks on mount, each gated client-side by
  // `auth.hasPermission(...)` — but any StaffDashboard render with a
  // permissive-enough session (e.g. the super_admin test fixture's
  // `hasPermission: () => true`) will fire all of them. Default handlers
  // here so a test that doesn't care about these panels' content doesn't
  // trip MSW's `onUnhandledRequest: 'error'`; overridden per-test via
  // server.use() where specific queue content is asserted.
  http.get('http://localhost:8000/api/accounts/kyc/pending/', () => {
    return HttpResponse.json([])
  }),
  http.get('http://localhost:8000/api/listings/moderation/pending/', () => {
    return HttpResponse.json([])
  }),
  http.get('http://localhost:8000/api/listings/hero/pending/', () => {
    return HttpResponse.json([])
  }),
  http.get('http://localhost:8000/api/accounts/customers/', () => {
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
  }),
  http.get('http://localhost:8000/api/accounts/business-owners/', () => {
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
  }),
  // KYC detail (staff dashboard review tools) — default handler, overridden
  // per-test where a specific applicant's full detail is asserted.
  http.get('http://localhost:8000/api/accounts/kyc/:id/', ({ params }) => {
    return HttpResponse.json({ id: Number(params.id), full_name: 'Owner', login_phone: '', email: '', kyc_status: 'pending', profile: {} })
  }),
  // Staff user-management detail/edit/suspend (staff dashboard review tools)
  // — default handlers, overridden per-test as needed.
  http.get('http://localhost:8000/api/accounts/customers/:id/', ({ params }) => {
    return HttpResponse.json({ id: Number(params.id), full_name: 'Customer', phone: '', email: '', is_suspended: false })
  }),
  http.patch('http://localhost:8000/api/accounts/customers/:id/', async ({ params, request }) => {
    return HttpResponse.json({ id: Number(params.id), ...(await request.json()) })
  }),
  http.post('http://localhost:8000/api/accounts/customers/:id/suspend/', ({ params }) => {
    return HttpResponse.json({ id: Number(params.id), is_suspended: true })
  }),
  http.post('http://localhost:8000/api/accounts/customers/:id/unsuspend/', ({ params }) => {
    return HttpResponse.json({ id: Number(params.id), is_suspended: false })
  }),
  http.get('http://localhost:8000/api/accounts/business-owners/:id/', ({ params }) => {
    return HttpResponse.json({ id: Number(params.id), full_name: 'Owner', login_phone: '', email: '', kyc_status: 'pending', is_suspended: false })
  }),
  http.patch('http://localhost:8000/api/accounts/business-owners/:id/', async ({ params, request }) => {
    return HttpResponse.json({ id: Number(params.id), ...(await request.json()) })
  }),
  http.post('http://localhost:8000/api/accounts/business-owners/:id/suspend/', ({ params }) => {
    return HttpResponse.json({ id: Number(params.id), is_suspended: true })
  }),
  http.post('http://localhost:8000/api/accounts/business-owners/:id/unsuspend/', ({ params }) => {
    return HttpResponse.json({ id: Number(params.id), is_suspended: false })
  }),
  // Staff account management (item 10) + permission editor (item 9) — default
  // handlers, overridden per-test as needed.
  http.post('http://localhost:8000/api/accounts/staff/:id/suspend/', ({ params }) => {
    return HttpResponse.json({ id: Number(params.id), status: 'suspended' })
  }),
  http.post('http://localhost:8000/api/accounts/staff/:id/unsuspend/', ({ params }) => {
    return HttpResponse.json({ id: Number(params.id), status: 'active' })
  }),
  http.post('http://localhost:8000/api/accounts/staff/:id/deactivate/', ({ params }) => {
    return HttpResponse.json({ id: Number(params.id), status: 'deactivated' })
  }),
  http.post('http://localhost:8000/api/accounts/staff/:id/reactivate/', ({ params }) => {
    return HttpResponse.json({ id: Number(params.id), status: 'active' })
  }),
  http.post('http://localhost:8000/api/accounts/staff/:id/permissions/', ({ params }) => {
    return HttpResponse.json({ id: Number(params.id), status: 'active' })
  }),
  http.get('http://localhost:8000/api/accounts/permissions/', () => {
    return HttpResponse.json([
      { codename: 'kyc.approve', description: 'Approve or reject KYC submissions' },
      { codename: 'users.view', description: 'View customer and business accounts' },
    ])
  }),
  // Field operations (item 11) — default handlers, overridden per-test.
  http.get('http://localhost:8000/api/accounts/scouts/', () => HttpResponse.json([])),
  http.get('http://localhost:8000/api/accounts/scout-assignments/', () => {
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
  }),
  http.post('http://localhost:8000/api/accounts/scout-assignments/', () => {
    return HttpResponse.json({ id: 1, status: 'assigned' }, { status: 201 })
  }),
  http.get('http://localhost:8000/api/accounts/scout-assignments/mine/', () => HttpResponse.json([])),
  http.post('http://localhost:8000/api/accounts/scout-assignments/:id/verify/', () => {
    return HttpResponse.json({ id: 1, status: 'visited' })
  }),
  http.get('http://localhost:8000/api/orders/delivery/', () => {
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
  }),
  http.get('http://localhost:8000/api/orders/dispatches/', () => HttpResponse.json([])),
  http.get('http://localhost:8000/api/orders/dispatch/', () => {
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
  }),
  http.post('http://localhost:8000/api/orders/:id/assign-dispatch/', () => {
    return HttpResponse.json({ id: 1, delivery_assignment: { status: 'assigned' } })
  }),
  http.post('http://localhost:8000/api/orders/delivery/:id/pickup/', () => HttpResponse.json({ id: 1, status: 'picked_up' })),
  http.post('http://localhost:8000/api/orders/delivery/:id/deliver/', () => HttpResponse.json({ id: 1, status: 'delivered' })),
  http.post('http://localhost:8000/api/orders/:id/confirm-receipt/', () => HttpResponse.json({ id: 1, status: 'confirmed' })),
  // Service requests (services app, business item 2) — default handlers.
  http.get('http://localhost:8000/api/services/requests/mine/', () => HttpResponse.json([])),
  http.get('http://localhost:8000/api/services/requests/incoming/', () => HttpResponse.json([])),
  http.post('http://localhost:8000/api/services/requests/', () => HttpResponse.json({ id: 1, status: 'requested' }, { status: 201 })),
  http.post('http://localhost:8000/api/services/requests/:id/respond/', () => HttpResponse.json({ id: 1, status: 'accepted' })),
  http.post('http://localhost:8000/api/services/requests/:id/pay/', () => HttpResponse.json({ id: 1, status: 'in_progress' })),
  http.post('http://localhost:8000/api/services/requests/:id/progress/', () => HttpResponse.json({ id: 1, status: 'in_progress' })),
  http.post('http://localhost:8000/api/services/requests/:id/complete/', () => HttpResponse.json({ id: 1, status: 'completed' })),
  // Bookings (bookings app, business item 2 / Wave H3) — default handlers.
  http.get('http://localhost:8000/api/bookings/mine/', () => HttpResponse.json([])),
  http.get('http://localhost:8000/api/bookings/incoming/', () => HttpResponse.json([])),
  http.post('http://localhost:8000/api/bookings/', () => HttpResponse.json({ id: 1, status: 'confirmed', check_in: '2026-08-01', check_out: '2026-08-03', total_price: '400.00' }, { status: 201 })),
  http.post('http://localhost:8000/api/bookings/:id/cancel/', () => HttpResponse.json({ id: 1, status: 'cancelled' })),
  http.post('http://localhost:8000/api/bookings/:id/check-in/', () => HttpResponse.json({ id: 1, status: 'checked_in' })),
  http.post('http://localhost:8000/api/bookings/:id/check-out/', () => HttpResponse.json({ id: 1, status: 'checked_out' })),
  http.get('http://localhost:8000/api/events/tickets/escrow/', () => {
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
  }),
  // Disputes (disputes app) — default handler, overridden per-test via
  // server.use() where a specific dispute-queue response is needed.
  http.get('http://localhost:8000/api/disputes/', () => {
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
  }),
  http.post('http://localhost:8000/api/disputes/:id/flag/', () => {
    return HttpResponse.json({ id: 1, status: 'investigating' })
  }),
  http.post('http://localhost:8000/api/disputes/:id/resolve/', () => {
    return HttpResponse.json({ id: 1, status: 'resolved' })
  }),
  http.post('http://localhost:8000/api/disputes/:id/re-review/', () => {
    return HttpResponse.json({ id: 1, status: 'open' })
  }),
  // Promotions management (staff) — unpaginated, unlike the disputes queue
  // above.
  http.get('http://localhost:8000/api/listings/promotions/', () => {
    return HttpResponse.json([])
  }),
  http.post('http://localhost:8000/api/listings/promotions/:id/cancel/', () => {
    return HttpResponse.json({ id: 1, status: 'cancelled' })
  }),
  // Transactions report (extended billing app) — default handler,
  // overridden per-test via server.use() where a specific report is needed.
  http.get('http://localhost:8000/api/billing/transactions/report/', () => {
    return HttpResponse.json({ summary: { count: 0, total_amount: '0.00' }, status_breakdown: {}, series: [] })
  }),
  // Messaging (messaging app) — default handlers, overridden per-test via
  // server.use() where specific conversation/thread content is needed.
  // GET /api/messaging/conversations/ (caller's own) has no pagination_class
  // on the backend, so it's a plain array — same convention as
  // GET /api/orders/ above.
  http.get('http://localhost:8000/api/messaging/conversations/', () => {
    return HttpResponse.json([])
  }),
  http.post('http://localhost:8000/api/messaging/conversations/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json(
      {
        id: 1, customer: 1, business_owner: null, starter_name: 'Customer', subject: body.subject || '',
        status: 'open',
        messages: [{ id: 1, conversation: 1, sender_type: 'customer', body: body.body, created_at: '2026-07-01T00:00:00Z' }],
        created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
      },
      { status: 201 },
    )
  }),
  http.post('http://localhost:8000/api/messaging/conversations/:id/messages/', async ({ params, request }) => {
    const body = await request.json()
    return HttpResponse.json(
      { id: 2, conversation: Number(params.id), sender_type: 'customer', body: body.body, created_at: '2026-07-01T00:00:00Z' },
      { status: 201 },
    )
  }),
  http.get('http://localhost:8000/api/messaging/staff/', () => {
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
  }),
  http.get('http://localhost:8000/api/messaging/staff/:id/', ({ params }) => {
    return HttpResponse.json({
      id: Number(params.id), customer: 1, business_owner: null, starter_name: 'Customer', subject: '', status: 'open',
      messages: [], created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
    })
  }),
  http.post('http://localhost:8000/api/messaging/staff/:id/reply/', async ({ params, request }) => {
    const body = await request.json()
    return HttpResponse.json(
      { id: 3, conversation: Number(params.id), sender_type: 'staff', body: body.body, created_at: '2026-07-01T00:00:00Z' },
      { status: 201 },
    )
  }),

  // Notifications (punch-list 5 & 10). AshantiHub calls useNotifications() at
  // its root for the bell badge on any signed-in render, and AdminCommandCenter
  // polls useStaffBadges() — both fire unconditionally, so these defaults must
  // exist even for tests that don't care about notifications.
  http.get('http://localhost:8000/api/notifications/', () => {
    return HttpResponse.json({ unread_count: 0, results: [] })
  }),
  http.post('http://localhost:8000/api/notifications/:id/read/', ({ params }) => {
    return HttpResponse.json({ id: Number(params.id), is_read: true })
  }),
  http.post('http://localhost:8000/api/notifications/read-all/', () => {
    return HttpResponse.json({ unread_count: 0 })
  }),
  http.get('http://localhost:8000/api/notifications/staff-badges/', () => {
    return HttpResponse.json({
      kyc: 0, listings: 0, events: 0, hero: 0, reviews: 0,
      plan_approvals: 0, contact_messages: 0, escrow: 0,
    })
  }),
]
