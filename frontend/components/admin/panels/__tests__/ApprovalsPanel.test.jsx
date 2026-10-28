import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ApprovalsPanel from '../ApprovalsPanel.jsx'

const HOUR = 3600 * 1000
const STALE = 'This changed since it was requested — ask for a fresh request.'

const approval = (overrides = {}) => ({
  id: 7, kind: 'business.update', kind_label: 'Business info change', title: 'Adwoa Fabrics', status: 'pending',
  stage: 'manager', maker: { id: 3, full_name: 'Kwame Asante', role: 'scout' },
  assigned_to: { id: 2, full_name: 'Ama Boateng', role: 'operations' }, pool_permission: 'kyc.approve',
  target: { type: 'accounts.businessowner', id: '5', label: 'Adwoa Fabrics' }, maker_note: 'The owner changed her phone',
  decided_by: null, decided_at: null, decision_note: '', due_at: new Date(Date.now() + 19 * HOUR).toISOString(),
  escalation_level: 0, created_at: new Date(Date.now() - 5 * HOUR).toISOString(), can_decide: true, can_cancel: false,
  ...overrides,
})
const detail = (overrides = {}) => ({
  ...approval(), payload: { phone: '0554000402' }, before: { phone: '0244000118' },
  diff: [{ field: 'phone', before: '0244000118', after: '0554000402' }], stale: false, ...overrides,
})

function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApprovalsPanel detailId={null} onOpenDetail={() => {}} {...props} />
    </QueryClientProvider>,
  )
}

describe('ApprovalsPanel inbox', () => {
  it('opens on the "Made by me" box when the detail is the box name (Today\'s See all)', async () => {
    let lastUrl = ''
    server.use(http.get('http://localhost:8000/api/approvals/', ({ request }) => { lastUrl = request.url; return HttpResponse.json({ count: 0, next: null, previous: null, results: [] }) }))
    renderPanel({ detailId: 'made' })
    await waitFor(() => expect(lastUrl).toContain('box=made'))
    expect(screen.getByRole('button', { name: /Made by me/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Could not load approval.')).not.toBeInTheDocument()
  })


  it('re-applies the box when the entry changes while mounted', async () => {
    server.use(http.get('http://localhost:8000/api/approvals/', () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const ui = (detailId) => <QueryClientProvider client={queryClient}><ApprovalsPanel detailId={detailId} onOpenDetail={() => {}} /></QueryClientProvider>
    const { rerender } = render(ui(null))
    expect(await screen.findByRole('button', { name: /Waiting for me/ })).toHaveAttribute('aria-pressed', 'true')
    rerender(ui('made'))
    await waitFor(() => expect(screen.getByRole('button', { name: /Made by me/ })).toHaveAttribute('aria-pressed', 'true'))
  })

  it('shows counts on the boxes and opens a waiting request', async () => {
    const onOpenDetail = vi.fn()
    server.use(
      http.get('http://localhost:8000/api/approvals/counts/', () => HttpResponse.json({ mine: 1, made: 0, team: 1, decided: 0, can_view_all: false })),
      http.get('http://localhost:8000/api/approvals/', () => HttpResponse.json({ count: 1, next: null, previous: null, results: [approval()] })),
    )
    renderPanel({ onOpenDetail })
    expect(await screen.findByText('Adwoa Fabrics')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Waiting for me · 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /Everything/ })).not.toBeInTheDocument()
    expect(screen.getByText(/moves on in 1[89] h/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Adwoa Fabrics' }))
    expect(onOpenDetail).toHaveBeenCalledWith(7)
  })

  it('asks for the box the user picks and says honestly when it is empty', async () => {
    let lastUrl = ''
    server.use(http.get('http://localhost:8000/api/approvals/', ({ request }) => {
      lastUrl = request.url
      return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
    }))
    renderPanel()
    expect(await screen.findByText(/Nothing is waiting for your decision/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Made by me' }))
    await waitFor(() => expect(lastUrl).toContain('box=made'))
    expect(await screen.findByText(/You haven't asked for any approvals/)).toBeInTheDocument()
  })
})

describe('ApprovalsPanel request', () => {
  it('shows what would change and approves it with a note', async () => {
    let body = null
    server.use(
      http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json(detail())),
      http.post('http://localhost:8000/api/approvals/7/approve/', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(detail({ status: 'approved', can_decide: false }))
      }),
    )
    renderPanel({ detailId: '7' })
    expect(await screen.findByRole('table', { name: 'What would change' })).toBeInTheDocument()
    expect(screen.getByText('0244000118')).toBeInTheDocument()
    expect(screen.getByText('0554000402')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Note to Kwame Asante/), { target: { value: 'Checked with the owner' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(body).toEqual({ note: 'Checked with the owner' }))
  })

  it('refreshes the counts, staff badges and notifications after a decision', async () => {
    const hits = { counts: 0, badges: 0, notifications: 0 }
    server.use(
      http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json(detail())),
      http.post('http://localhost:8000/api/approvals/7/approve/', () => HttpResponse.json(detail({ status: 'approved', can_decide: false }))),
      http.get('http://localhost:8000/api/approvals/counts/', () => { hits.counts += 1; return HttpResponse.json({ mine: 0, made: 0, team: 0, decided: 0, can_view_all: false }) }),
      http.get('http://localhost:8000/api/notifications/staff-badges/', () => { hits.badges += 1; return HttpResponse.json({ approvals_waiting: 0 }) }),
      http.get('http://localhost:8000/api/notifications/', () => { hits.notifications += 1; return HttpResponse.json({ unread_count: 0, results: [] }) }),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { useApprovalCounts } = await import('../../../../hooks/useApprovals.js')
    const { useStaffBadges } = await import('../../../../hooks/useStaffBadges.js')
    const { useNotifications } = await import('../../../../hooks/useNotifications.js')
    function Observers() { useApprovalCounts(); useStaffBadges(); useNotifications(true); return null }
    render(
      <QueryClientProvider client={queryClient}>
        <Observers />
        <ApprovalsPanel detailId="7" onOpenDetail={() => {}} />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(hits.counts).toBeGreaterThanOrEqual(2))
    await waitFor(() => expect(hits.badges).toBeGreaterThanOrEqual(2))
    await waitFor(() => expect(hits.notifications).toBeGreaterThanOrEqual(2))
  })

  it('refetches the request after a refused decision, so a decided request loses its buttons', async () => {
    let gets = 0
    server.use(
      http.get('http://localhost:8000/api/approvals/7/', () => {
        gets += 1
        return HttpResponse.json(gets === 1 ? detail() : detail({ status: 'approved', can_decide: false, decided_by: { id: 2, full_name: 'Ama Boateng' }, decided_at: new Date().toISOString() }))
      }),
      http.post('http://localhost:8000/api/approvals/7/approve/', () => HttpResponse.json({ detail: 'Already decided.' }, { status: 400 })),
    )
    renderPanel({ detailId: '7' })
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('Already decided.')
    expect(gets).toBe(2)
  })

  it('says a missing request is missing, and offers a retry for any other load error', async () => {
    server.use(http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json({ detail: 'Not found.' }, { status: 404 })))
    renderPanel({ detailId: '7' })
    expect(await screen.findByText("This request doesn't exist, or isn't one you can see.")).toBeInTheDocument()
  })

  it('shows a retry button when the request fails to load for another reason', async () => {
    let gets = 0
    server.use(http.get('http://localhost:8000/api/approvals/7/', () => {
      gets += 1
      return gets === 1 ? HttpResponse.json({ detail: 'boom' }, { status: 500 }) : HttpResponse.json(detail())
    }))
    renderPanel({ detailId: '7' })
    expect(await screen.findByText("Couldn't load this request. Try again.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table', { name: 'What would change' })).toBeInTheDocument()
  })

  it('needs a note to return a request', async () => {
    let returned = null
    server.use(
      http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json(detail())),
      http.post('http://localhost:8000/api/approvals/7/reject/', async ({ request }) => {
        returned = await request.json()
        return HttpResponse.json(detail({ status: 'rejected', can_decide: false }))
      }),
    )
    renderPanel({ detailId: '7' })
    const returnButton = await screen.findByRole('button', { name: 'Return with note' })
    expect(returnButton).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Note to Kwame Asante/), { target: { value: 'Ask the owner for a photo' } })
    fireEvent.click(returnButton)
    await waitFor(() => expect(returned).toEqual({ note: 'Ask the owner for a photo' }))
  })

  it('blocks approving a request whose target changed', async () => {
    server.use(http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json(detail({ stale: true }))))
    renderPanel({ detailId: '7' })
    expect(await screen.findByText(STALE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
  })

  it("tells the maker they can't approve their own request and lets them cancel", async () => {
    let cancelled = false
    server.use(
      http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json(detail({ can_decide: false, can_cancel: true }))),
      http.post('http://localhost:8000/api/approvals/7/cancel/', () => { cancelled = true; return HttpResponse.json(detail({ status: 'cancelled', can_cancel: false })) }),
    )
    renderPanel({ detailId: '7' })
    expect(await screen.findByText("You made this request. You can cancel it while it's waiting.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }))
    await waitFor(() => expect(cancelled).toBe(true))
  })

  it('shows the server reason when a decision is refused', async () => {
    server.use(
      http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json(detail())),
      http.post('http://localhost:8000/api/approvals/7/approve/', () => HttpResponse.json({ detail: STALE }, { status: 409 })),
    )
    renderPanel({ detailId: '7' })
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(STALE)
  })

  it('goes back to the inbox', async () => {
    const onOpenDetail = vi.fn()
    server.use(http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json(detail())))
    renderPanel({ detailId: '7', onOpenDetail })
    fireEvent.click(await screen.findByRole('button', { name: '← Approvals' }))
    expect(onOpenDetail).toHaveBeenCalledWith(null)
  })
})

describe('ApprovalsPanel — scout requests (staff phase 2A)', () => {
  const API = 'http://localhost:8000'
  const REVIEW = {
    owner: { full_name: 'Nana Adwoa Agyeman', login_phone: '+233245555531', email: null, ghana_card_number: 'GHA-723456741-3', needs_claim: false, claimed_at: '2026-10-07T06:52:00Z' },
    business: { business_name: "Nana's Chop Bar", business_kind: 'service', category: { id: 4, name: 'Food & drink' }, zone: { id: 3, name: 'Asafo' }, opening_hours: '', is_formal: false, tin_given: false },
    photos: { signboard: null, ghana_card_front: null, ghana_card_back: null },
    location: { lat: 6.69, lng: -1.62, accuracy_m: 12, is_manual: false, set_by: 'scout', set_at: '2026-10-07T06:37:00Z', gps_address: 'AK-039-5128', address_verified: false, address_verified_by_name: null, address_verified_at: null },
    checks: { exact: [], similar: [], staff_match: false, accuracy_m: 12 },
    consent: null, flags: [], registered_by_name: 'Kwame Asante', created_at: '2026-10-07T06:46:00Z',
  }
  const kycRequest = (overrides = {}) => detail({
    id: 9, kind: 'business.kyc', kind_label: 'New business (KYC)', title: "Nana's Chop Bar", pool_permission: 'kyc.approve',
    target: { type: 'accounts.businessowner', id: '41', label: "Nana's Chop Bar" }, payload: {}, before: {},
    diff: [
      { field: 'Business', before: null, after: "Nana's Chop Bar" },
      { field: 'Registered by', before: null, after: 'Kwame Asante' },
      { field: 'Ghana Post address', before: null, after: 'AK-039-5128 · not checked yet' },
    ],
    ...overrides,
  })

  it('shows photo rows as thumbnails', async () => {
    server.use(http.get(`${API}/api/approvals/7/`, () => HttpResponse.json(detail({
      kind: 'listing.photos', kind_label: 'Listing photos', title: 'Rice, 50 kg bag',
      diff: [
        { field: 'Listing', before: null, after: 'Rice, 50 kg bag' },
        { field: 'Photos', before: null, after: { images: ['/media/portfolio/staged/a.jpg', 'https://cdn.example.com/b.jpg'] } },
      ],
    }))))
    renderPanel({ detailId: '7' })
    const table = await screen.findByRole('table', { name: 'What would change' })
    const photos = within(table).getByRole('list', { name: 'Photos' })
    expect(within(photos).getByRole('img', { name: 'Photos 1 of 2' })).toHaveAttribute('src', 'http://localhost:8000/media/portfolio/staged/a.jpg')
    expect(within(photos).getByRole('img', { name: 'Photos 2 of 2' })).toHaveAttribute('src', 'https://cdn.example.com/b.jpg')
    expect(within(table).queryByText(/images/)).not.toBeInTheDocument()
  })

  it('shows the KYC review sheet for a new business and lets the decider record the address', async () => {
    server.use(
      http.get(`${API}/api/approvals/9/`, () => HttpResponse.json(kycRequest())),
      http.get(`${API}/api/portfolio/businesses/41/review/`, () => HttpResponse.json(REVIEW)),
    )
    renderPanel({ detailId: '9' })
    expect(await screen.findByRole('heading', { name: 'Duplicate and self-dealing checks' })).toBeInTheDocument()
    expect(screen.getByText('Ghana Post address as typed: AK-039-5128')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Address verified' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve KYC' })).toBeInTheDocument()
  })

  it('shows the owner-confirmation line on the KYC sheet, and the server reason when Approve KYC is refused until the owner confirms', async () => {
    const line = 'Waiting — text sent to 024 *** 1234 on 5 Oct, expires 12 Oct'
    const message = 'The owner has not confirmed this registration yet.'
    server.use(
      http.get(`${API}/api/approvals/9/`, () => HttpResponse.json(kycRequest())),
      http.get(`${API}/api/portfolio/businesses/41/review/`, () => HttpResponse.json({ ...REVIEW, owner_confirmation: { confirmed: false, line } })),
      http.post(`${API}/api/approvals/9/approve/`, () => HttpResponse.json({ detail: message, code: 'confirmation_missing' }, { status: 409 })),
    )
    renderPanel({ detailId: '9' })
    expect(await screen.findByText(line)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve KYC' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('refreshes the request table when the address decision is recorded', async () => {
    let approvalGets = 0
    server.use(
      http.get(`${API}/api/approvals/9/`, () => {
        approvalGets += 1
        return HttpResponse.json(approvalGets === 1 ? kycRequest() : kycRequest({
          diff: [
            { field: 'Business', before: null, after: "Nana's Chop Bar" },
            { field: 'Ghana Post address', before: null, after: 'AK-039-5128 · verified by Ama Boateng' },
          ],
        }))
      }),
      http.get(`${API}/api/portfolio/businesses/41/review/`, () => HttpResponse.json(REVIEW)),
      http.post(`${API}/api/accounts/kyc/41/address-verify/`, () => HttpResponse.json({ id: 41, address_verified: true })),
    )
    renderPanel({ detailId: '9' })
    const table = await screen.findByRole('table', { name: 'What would change' })
    expect(within(table).getByText('AK-039-5128 · not checked yet')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Address verified' }))
    expect(await within(table).findByText('AK-039-5128 · verified by Ama Boateng')).toBeInTheDocument()
  })

  it("shows the sheet read-only to someone who can't decide the request", async () => {
    server.use(
      http.get(`${API}/api/approvals/9/`, () => HttpResponse.json(kycRequest({ can_decide: false, can_cancel: true }))),
      http.get(`${API}/api/portfolio/businesses/41/review/`, () => HttpResponse.json(REVIEW)),
    )
    renderPanel({ detailId: '9' })
    expect(await screen.findByRole('heading', { name: 'Duplicate and self-dealing checks' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Address verified' })).not.toBeInTheDocument()
  })

  it('asks for no review sheet on other kinds', async () => {
    let reviews = 0
    server.use(
      http.get(`${API}/api/approvals/7/`, () => HttpResponse.json(detail())),
      http.get(`${API}/api/portfolio/businesses/:id/review/`, () => { reviews += 1; return HttpResponse.json(REVIEW) }),
    )
    renderPanel({ detailId: '7' })
    expect(await screen.findByRole('table', { name: 'What would change' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Duplicate and self-dealing checks' })).not.toBeInTheDocument()
    expect(reviews).toBe(0)
  })
})

describe('ApprovalsPanel staff-made listing', () => {
  const listingDetail = (payloadOver = {}) => detail({
    id: 9, kind: 'listing.staff_create', kind_label: 'Listing made by staff', title: 'Banku and tilapia', can_decide: true,
    target: { type: 'portfolio.listingdraft', id: '31', label: 'Banku and tilapia' }, payload: { draft_id: 31, business_owner_id: 52, ...payloadOver },
    before: {}, diff: [
      { field: 'Business', before: null, after: "Akosua's Kitchen" },
      { field: 'Text sent to', before: null, after: '024 *** 1234 (texts are simulated)' },
    ],
  })

  it('shows the number the owner text went to masked, and reveals it through the recorded endpoint only on click', async () => {
    let revealed = 0
    server.use(
      http.get('http://localhost:8000/api/approvals/9/', () => HttpResponse.json(listingDetail())),
      http.post('http://localhost:8000/api/portfolio/businesses/52/reveal-phone/', () => { revealed += 1; return HttpResponse.json({ login_phone: '+233241231234' }) }),
    )
    renderPanel({ detailId: 9 })
    const row = (await screen.findByText('Text sent to')).closest('tr')
    expect(within(row).getByText(/024 \*\*\* 1234/)).toBeInTheDocument()
    expect(screen.queryByText(/233241231234/)).not.toBeInTheDocument()
    expect(revealed).toBe(0)
    fireEvent.click(within(row).getByRole('button', { name: /Show full phone number/ }))
    expect(await within(row).findByText(/\+233241231234/)).toBeInTheDocument()
    expect(revealed).toBe(1)
  })

  it('drops a revealed number when another approval is opened', async () => {
    const other = { ...listingDetail({ business_owner_id: 77 }), id: 10, title: 'Fufu' }
    server.use(
      http.get('http://localhost:8000/api/approvals/9/', () => HttpResponse.json(listingDetail())),
      http.get('http://localhost:8000/api/approvals/10/', () => HttpResponse.json(other)),
      http.post('http://localhost:8000/api/portfolio/businesses/52/reveal-phone/', () => HttpResponse.json({ login_phone: '+233241231234' })),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const ui = (detailId) => <QueryClientProvider client={queryClient}><ApprovalsPanel detailId={detailId} onOpenDetail={() => {}} /></QueryClientProvider>
    const { rerender } = render(ui(9))
    const row = (await screen.findByText('Text sent to')).closest('tr')
    fireEvent.click(within(row).getByRole('button', { name: /Show full phone number/ }))
    expect(await within(row).findByText(/233241231234/)).toHaveTextContent(/Owner's sign-in number/)
    rerender(ui(10))
    await screen.findByRole('heading', { name: 'Fufu' })
    expect(screen.queryByText(/233241231234/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Show full phone number/ })).toBeInTheDocument()
  })

  it('shows the reveal error rather than a number when the reveal is refused', async () => {
    server.use(
      http.get('http://localhost:8000/api/approvals/9/', () => HttpResponse.json(listingDetail())),
      http.post('http://localhost:8000/api/portfolio/businesses/52/reveal-phone/', () => HttpResponse.json({ detail: 'You cannot see this number.' }, { status: 403 })),
    )
    renderPanel({ detailId: 9 })
    const row = (await screen.findByText('Text sent to')).closest('tr')
    fireEvent.click(within(row).getByRole('button', { name: /Show full phone number/ }))
    expect(await within(row).findByRole('alert')).toHaveTextContent('You cannot see this number.')
  })

  it('offers no reveal when the approval carries no owner id (made before the id was kept)', async () => {
    server.use(http.get('http://localhost:8000/api/approvals/9/', () => HttpResponse.json(listingDetail({ business_owner_id: undefined }))))
    renderPanel({ detailId: 9 })
    const row = (await screen.findByText('Text sent to')).closest('tr')
    expect(within(row).queryByRole('button', { name: /Show full phone number/ })).not.toBeInTheDocument()
  })
})
