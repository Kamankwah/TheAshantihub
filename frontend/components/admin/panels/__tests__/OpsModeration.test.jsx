import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import BusinessKycReview from '../BusinessKycReview.jsx'
import HeroEventsPanel from '../HeroEventsPanel.jsx'
import KYCQueuePanel from '../KYCQueuePanel.jsx'
import ListingsModerationPanel from '../ListingsModerationPanel.jsx'
import ReviewsModerationPanel from '../ReviewsModerationPanel.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}
const auth = (...codes) => ({ hasPermission: (c) => codes.includes(c) })

describe('KYC queue (Operations canvas)', () => {
  const owner = {
    id: 41, full_name: 'Kofi Asamoah', business_name: 'Manhyia Tailoring', login_phone: '020 *** 4417', kyc_status: 'pending',
    kyc_rejection_reason: null, created_at: '2026-10-05T09:10:00Z', reviewed_by_name: null, reviewed_at: null,
    registration_channel: 'self', registered_by_name: null, registered_by_role: null, open_fraud_flags: [], pending_approval_id: null,
  }
  const detail = {
    ...owner, email: '', profile: { gps_address: 'AK-412-0937', is_formal: false, address_verified: false, address_verified_at: null },
    business_name: 'Manhyia Tailoring', lat: null, lng: null,
  }
  const serve = () => server.use(
    http.get(`${API}/api/accounts/kyc/pending/`, ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('status') === 'pending' ? [owner] : [])),
    http.get(`${API}/api/accounts/kyc/stats/`, () => HttpResponse.json({ week_verified: 18, week_rejected: 2 })),
    http.get(`${API}/api/accounts/kyc/:id/`, () => HttpResponse.json(detail)),
    http.get(`${API}/api/accounts/scouts/`, () => HttpResponse.json([{ id: 5, full_name: 'Efua Mensah' }])),
  )

  it('names the business, shows the phone masked and the weekly count under the queue', async () => {
    serve()
    wrap(<KYCQueuePanel auth={auth()} />)
    expect(await screen.findByText('Kofi Asamoah · Manhyia Tailoring')).toBeInTheDocument()
    expect(screen.getByText(/020 \*\*\* 4417 • submitted Mon 5 Oct/)).toBeInTheDocument()
    expect(await screen.findByText(/This week: 18 verified · 2 rejected\. Rejecting needs a reason the owner sees/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pending · 1' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows the full phone only after the recorded reveal', async () => {
    serve()
    server.use(http.post(`${API}/api/portfolio/businesses/41/reveal-phone/`, () => HttpResponse.json({ login_phone: '+233204404417' })))
    wrap(<KYCQueuePanel auth={auth()} />)
    fireEvent.click(await screen.findByText('👁️ View Details'))
    fireEvent.click(await screen.findByRole('button', { name: 'Show full phone number (recorded)' }))
    expect(await screen.findByText('+233204404417')).toBeInTheDocument()
    expect(screen.getByText(/this was recorded in the activity log/)).toBeInTheDocument()
  })

  it('lets someone who can assign scouts send one to verify the address', async () => {
    let body = null
    serve()
    server.use(http.post(`${API}/api/accounts/scout-assignments/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 1 }, { status: 201 }) }))
    wrap(<KYCQueuePanel auth={auth('scouts.assign')} />)
    fireEvent.click(await screen.findByText('👁️ View Details'))
    const send = await screen.findByRole('button', { name: 'Send a scout to verify' })
    expect(send).toBeDisabled()
    await screen.findByRole('option', { name: 'Efua Mensah' })
    fireEvent.change(screen.getByLabelText('Scout to send'), { target: { value: '5' } })
    fireEvent.click(send)
    expect(await screen.findByText('Sent: Efua Mensah will verify it on site.')).toBeInTheDocument()
    expect(body).toEqual({ business_owner: 41, scout: 5 })
  })

  it('does not offer to send a scout without scouts.assign', async () => {
    serve()
    wrap(<KYCQueuePanel auth={auth()} />)
    fireEvent.click(await screen.findByText('👁️ View Details'))
    await screen.findByText(/Confirm the digital address/)
    expect(screen.queryByRole('button', { name: 'Send a scout to verify' })).not.toBeInTheDocument()
  })
})

describe('BusinessKycReview phone reveal', () => {
  const sheet = {
    owner: { full_name: 'Nana Adwoa', login_phone: '024 *** 5531', email: null, ghana_card_number: null, needs_claim: false, claimed_at: null },
    business: { business_name: "Nana's", business_kind: null, category: null, zone: null, opening_hours: '', is_formal: false, tin_given: false },
    photos: {}, location: { lat: null, lng: null, address_verified_at: null }, checks: {}, flags: [], consent: null, created_at: '2026-10-07T06:46:00Z',
  }
  it('masks the number, reveals it on request and shows the server reason when refused', async () => {
    let calls = 0
    server.use(
      http.get(`${API}/api/portfolio/businesses/41/review/`, () => HttpResponse.json(sheet)),
      http.post(`${API}/api/portfolio/businesses/41/reveal-phone/`, () => {
        calls += 1
        return calls === 1 ? HttpResponse.json({ detail: 'Not allowed.' }, { status: 403 }) : HttpResponse.json({ login_phone: '+233245555531' })
      }),
    )
    wrap(<BusinessKycReview businessId="41" />)
    expect(await screen.findByText('024 *** 5531')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Show full phone number (recorded)' })
    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed.')
    fireEvent.click(button)
    expect(await screen.findByText('+233245555531')).toBeInTheDocument()
    expect(screen.queryByText('024 *** 5531')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show full phone number (recorded)' })).not.toBeInTheDocument()
  })
})

describe('Listings moderation (Operations canvas)', () => {
  const listing = (o = {}) => ({
    id: 1, name: 'Brake pads', business_owner_name: 'Suame Auto Parts', category: { label: 'Auto parts' }, zone: { name: 'Suame' },
    price_amount: '280.00', contact_phone: '+233244000001', specs: [{ label: 'Condition', value: 'new' }], photos: [],
    open_fraud_cases: 0, subscription_overdue: null, ...o,
  })
  const serve = (pending) => server.use(
    http.get(`${API}/api/listings/moderation/pending/`, ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('status') === 'pending' ? pending : [])),
    http.get(`${API}/api/listings/moderation/stats/`, () => HttpResponse.json({ week_published: 23, week_rejected: 4 })),
  )

  it('flags an open fraud case and an overdue subscription, only when they are real', async () => {
    serve([
      listing({ open_fraud_cases: 1 }),
      listing({ id: 2, name: 'Ankara fabric', business_owner_name: 'Adwoa Fabrics', subscription_overdue: { day: 9, grace_days: 14 } }),
      listing({ id: 3, name: 'Sandals', business_owner_name: 'Kumasi Leather Works', subscription_overdue: { day: 3, grace_days: null } }),
      listing({ id: 4, name: 'Braids', business_owner_name: 'Asafo Hair Studio' }),
    ])
    wrap(<ListingsModerationPanel />)
    expect(await screen.findByText('Open fraud case on this business — check before approving')).toBeInTheDocument()
    expect(screen.getByText('Subscription overdue · day 9 of 14')).toBeInTheDocument()
    expect(screen.getByText('Subscription overdue · day 3')).toBeInTheDocument()
    expect(screen.getAllByText(/Subscription overdue|Open fraud case/)).toHaveLength(3)
    expect(screen.getAllByText('Condition: new')).toHaveLength(4)
  })

  it('explains where scout listings go and states this week\'s decisions', async () => {
    serve([listing()])
    wrap(<ListingsModerationPanel />)
    expect(await screen.findByText(/Listings a scout adds for a business come through your Approvals inbox/)).toBeInTheDocument()
    expect(await screen.findByText(/This week: 23 published · 4 rejected\. Every decision records who made it/)).toBeInTheDocument()
  })
})

describe('Reviews moderation (Operations canvas)', () => {
  const review = (o = {}) => ({
    id: 1, target_type: 'seller', target_name: 'Suame Auto Parts', rating: 2, comment: 'Call 0244123456', verified: false, author_name: 'A customer',
    status: 'pending', created_at: '2026-10-06T10:00:00Z', contains_phone: false, open_dispute_order: null, ...o,
  })
  const serve = (byStatus) => server.use(
    http.get(`${API}/api/reviews/moderation/`, ({ request }) => {
      const results = byStatus[new URL(request.url).searchParams.get('status')] || []
      return HttpResponse.json({ count: results.length, next: null, previous: null, results })
    }),
  )

  it('flags a phone number and an open dispute, and unflagged reviews carry no chip', async () => {
    serve({ pending: [review({ contains_phone: true }), review({ id: 2, comment: 'Wrong size', open_dispute_order: 15 }), review({ id: 3, comment: 'Fine' })] })
    wrap(<ReviewsModerationPanel auth={auth()} />)
    expect(await screen.findByText('Contains a phone number')).toBeInTheDocument()
    expect(screen.getByText('Order #15 has a dispute still open with this business')).toBeInTheDocument()
    expect(screen.getAllByText(/Contains a phone number|dispute still open/)).toHaveLength(2)
    expect(screen.getAllByText('2/5')).toHaveLength(3)
    expect(screen.getByText(/A new review stays out of public view until it's published here/)).toBeInTheDocument()
  })

  it('lists recently hidden reviews with who hid them, and the super admin rule', async () => {
    serve({
      pending: [review()],
      rejected: [review({ id: 9, status: 'hidden', comment: 'Pay on WhatsApp', target_name: 'Kejetia Phone Hub', hidden_reason: 'Asked for payment outside the app', reviewed_by_name: 'Esi Nyarko', reviewed_by_role: 'Support', reviewed_at: '2026-10-03T10:00:00Z' })],
    })
    wrap(<ReviewsModerationPanel auth={auth()} />)
    const strip = (await screen.findByRole('heading', { name: 'Recently hidden' })).closest('section')
    expect(within(strip).getByText('Hidden: Asked for payment outside the app')).toBeInTheDocument()
    expect(within(strip).getByText(/by Esi Nyarko \(Support\) · Sat 3 Oct/)).toBeInTheDocument()
    expect(within(strip).getByText('Only Super Admin can bring back a hidden review.')).toBeInTheDocument()
  })
})

describe('Sponsored toggle on the Operations listings panel', () => {
  const item = (o = {}) => ({
    id: 1, business_owner_name: 'Akosua Ntoma Kente', name: 'Kente stole', category: { id: 1, label: 'Fashion', kind: 'product' }, zone: { name: 'Adum' },
    price_amount: '450.00', contact_phone: '', specs: [], photos: [], status: 'published', sponsored: false, open_fraud_cases: 0, subscription_overdue: null, ...o,
  })
  const serve = (rows) => server.use(
    http.get(`${API}/api/listings/moderation/pending/`, ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('status') === 'approved' ? rows : [])),
    http.get(`${API}/api/listings/moderation/stats/`, () => HttpResponse.json({})),
  )
  it('flags a published product for deals.manage holders only, never a service', async () => {
    const seen = []
    serve([item(), item({ id: 2, name: 'Braiding', category: { id: 2, label: 'Hair', kind: 'service' } })])
    server.use(http.post(`${API}/api/listings/:id/sponsored/`, async ({ request, params }) => { seen.push({ id: params.id, ...(await request.json()) }); return HttpResponse.json({ id: 1, sponsored: true }) }))
    const { unmount } = wrap(<ListingsModerationPanel auth={auth('deals.manage')} />)
    fireEvent.click(await screen.findByRole('button', { name: /^(Approved|Published)/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Mark Kente stole as sponsored' }))
    await waitFor(() => expect(seen).toEqual([{ id: '1', sponsored: true }]))
    expect(screen.queryByRole('button', { name: /Braiding as sponsored/ })).toBeNull()
    unmount()
    serve([item()])
    wrap(<ListingsModerationPanel auth={auth()} />)
    fireEvent.click(await screen.findByRole('button', { name: /^(Approved|Published)/ }))
    await screen.findByText('Kente stole')
    expect(screen.queryByRole('button', { name: /as sponsored/ })).toBeNull()
  })
})

describe('Hero & events (one screen)', () => {
  const hero = (o = {}) => ({
    id: 1, business_owner_name: 'Akosua Ntoma Kente', media: 'http://x/a.jpg', media_type: 'image', caption: 'New Sika Futuro kente',
    status: 'pending', submitted_at: '2026-10-06T10:00:00Z', reviewed_by_name: null, reviewed_by_role: null, reviewed_at: null, ...o,
  })
  const serveQueues = () => server.use(
    http.get(`${API}/api/listings/hero/pending/`, ({ request }) => {
      const status = new URL(request.url).searchParams.get('status')
      if (status === 'approved') return HttpResponse.json([hero({ id: 5, business_owner_name: 'Kumasi Leather Works', caption: 'Handmade in Adum', status: 'approved', reviewed_by_name: 'Akua Sarpong', reviewed_by_role: 'Marketing', reviewed_at: '2026-10-05T10:00:00Z' })])
      return HttpResponse.json(status === 'pending' ? [hero()] : [])
    }),
    http.get(`${API}/api/events/moderation/pending/`, ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('status') === 'pending'
      ? [{ id: 8, name: 'Bonwire Kente Weaving Day', category: { label: 'Culture' }, zone: { name: 'Bonwire' }, visibility_days: 7, submitted_by_business_name: 'Akosua Ntoma Kente' }] : [])),
  )

  it('composes both queues and says who decided last, with their team', async () => {
    serveQueues()
    wrap(<HeroEventsPanel auth={auth('hero_media.approve', 'event.approve')} />)
    expect(await screen.findByText('New Sika Futuro kente', { exact: false })).toBeInTheDocument()
    expect(await screen.findByText('Bonwire Kente Weaving Day')).toBeInTheDocument()
    expect(screen.getByText(/Marketing works these queues too\. Whoever decides first is recorded/)).toBeInTheDocument()
    expect(await screen.findByText('Last decided: Kumasi Leather Works “Handmade in Adum” — approved by Akua Sarpong (Marketing) · Mon 5 Oct.')).toBeInTheDocument()
    expect(screen.getByText(/joins the homepage hero once approved/)).toBeInTheDocument()
  })

  it('shows only the queue the person may decide', async () => {
    serveQueues()
    wrap(<HeroEventsPanel auth={auth('event.approve')} />)
    expect(await screen.findByText('Bonwire Kente Weaving Day')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Hero submissions')).not.toBeInTheDocument())
  })
})
