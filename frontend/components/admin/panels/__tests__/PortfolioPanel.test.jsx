import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setStoredAuth } from '../../../../apiClient.js'
import { server } from '../../../../mocks/server.js'
import AdminCommandCenter from '../../AdminCommandCenter.jsx'
import PortfolioPanel from '../PortfolioPanel.jsx'

const API = 'http://localhost:8000'
const SCOUT = {
  user: { id: 7, full_name: 'Kwame Asante', role: 'scout', account_type: 'staff' },
  hasPermission: (c) => ['businesses.manage_portfolio', 'businesses.register', 'calls.log'].includes(c),
}
const OPS = {
  user: { id: 2, full_name: 'Ama Boateng', role: 'operations', account_type: 'staff' },
  hasPermission: (c) => ['portfolio.manage', 'calls.log', 'staff.invite_team'].includes(c),
}
const TEAM = [
  { id: 9, full_name: 'Efua Mensah', role: 'scout', status: 'active' },
  { id: 10, full_name: 'Esi Nyarko', role: 'support', status: 'active' },
  { id: 7, full_name: 'Kwame Asante', role: 'scout', status: 'active' },
]
const SUMMARY = { total: 3, healthy: 1, needs_attention: 1, at_risk: 1, new: 0, unassigned: 1, at_risk_week_ago: 0 }

const row = (overrides = {}) => ({
  id: 12, business_name: 'Adwoa Fabrics', owner_name: 'Adwoa Frimpong', login_phone: '+233244000118',
  zone: { id: 3, name: 'Bantama' }, kyc_status: 'verified', registration_channel: 'scout', needs_claim: false,
  claimed_at: '2026-08-12T10:00:00Z', account_manager: { id: 7, full_name: 'Kwame Asante' },
  health: { rating: 'needs_attention', reasons: ['Subscription overdue'] },
  subscription: { state: 'overdue', overdue_day: 4, hide_on: '2026-10-18', plan_name: 'Monthly', monthly_price: '120.00' },
  listings_live: 6, listings_total: 6, listings_waiting: 0, last_order_at: '2026-10-02T10:00:00Z',
  last_contact: { kind: 'call', at: '2026-10-07T16:10:00Z' }, open_fraud_flags: 0,
  ...overrides,
})
const detailOf = (r) => ({
  ...r, business_kind: 'product', business_category: null, gps_address: 'AK-087-2210', lat: null, lng: null,
  location_accuracy_m: null, location_is_manual: false, location_set_by: 'scout', business_contact_phone: r.login_phone,
  business_description: '', opening_hours: '', signboard_photo: null, email: '', registered_by: null,
  created_at: '2026-08-10T09:00:00Z', listings: [], pending_requests: [], recent_calls: [], assignments: [],
  open_flags: [], can_manage: true,
})
const ROWS = [
  row({
    id: 14, business_name: 'Bantama Cold Store', health: { rating: 'at_risk', reasons: ['Subscription paused', 'No listing live'] },
    subscription: { state: 'paused', paused_at: '2026-10-02T00:00:00Z' }, listings_live: 0, listings_total: 5,
  }),
  row(),
  row({
    id: 15, business_name: "Nana's Chop Bar", needs_claim: true, claimed_at: null, kyc_status: 'pending',
    health: { rating: 'new', reasons: ['KYC waiting'] }, subscription: { state: 'none' }, listings_live: 0,
    listings_total: 0, last_contact: null, account_manager: null, registration_channel: 'self',
  }),
]
const page = (results, summary = SUMMARY, extra = {}) => ({ count: results.length, next: null, previous: null, results, summary, ...extra })

function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <PortfolioPanel mode="mine" auth={SCOUT} detailId={null} onOpenDetail={() => {}} {...props} />
    </QueryClientProvider>,
  )
}
function recordList(urls, results = ROWS, summary = SUMMARY) {
  server.use(http.get(`${API}/api/portfolio/businesses/`, ({ request }) => {
    urls.push(request.url)
    return HttpResponse.json(page(results, summary))
  }))
}
const param = (url, key) => new URL(url).searchParams.get(key)

describe("PortfolioPanel — a scout's portfolio", () => {
  it('lists the businesses with health, subscription, listings and last contact', async () => {
    const urls = []
    recordList(urls)
    renderPanel()
    const card = await screen.findByRole('article', { name: 'Adwoa Fabrics' })
    expect(within(card).getByText('Needs attention')).toBeInTheDocument()
    expect(within(card).getByText('Bantama · Subscription overdue')).toBeInTheDocument()
    expect(within(card).getByText('Overdue · day 4 of 14')).toBeInTheDocument()
    const cold = screen.getByRole('article', { name: 'Bantama Cold Store' })
    expect(within(cold).getByText('Paused — listings hidden')).toBeInTheDocument()
    expect(within(cold).getByText('0 of 5')).toBeInTheDocument()
    const nana = screen.getByRole('article', { name: "Nana's Chop Bar" })
    expect(within(nana).getByText("🔒 Owner hasn't set a login yet")).toBeInTheDocument()
    expect(within(nana).getByText('Starts after KYC')).toBeInTheDocument()
    expect(within(nana).getByText('None yet')).toBeInTheDocument()
    expect(screen.getByText('3 businesses you manage')).toBeInTheDocument()
    expect(param(urls[0], 'scope')).toBe('mine')
  })

  it('filters by health, with the count on each chip', async () => {
    const urls = []
    recordList(urls)
    renderPanel()
    const atRisk = await screen.findByRole('button', { name: 'At risk · 1' })
    expect(screen.getByRole('button', { name: 'All · 3' })).toHaveAttribute('aria-pressed', 'true')
    // DESIGN.md: counts in tabular figures.
    expect(atRisk.style.fontVariantNumeric).toBe('tabular-nums')
    fireEvent.click(atRisk)
    await waitFor(() => expect(urls.some((u) => param(u, 'health') === 'at_risk')).toBe(true))
    expect(screen.getByRole('button', { name: 'At risk · 1' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('searches by name, area or owner', async () => {
    const urls = []
    recordList(urls)
    renderPanel()
    fireEvent.change(await screen.findByLabelText('Search my businesses'), { target: { value: 'adwoa' } })
    await waitFor(() => expect(urls.some((u) => param(u, 'q') === 'adwoa')).toBe(true))
  })

  it('says honestly when the scout manages no business yet', async () => {
    recordList([], [], { ...SUMMARY, total: 0, healthy: 0, needs_attention: 0, at_risk: 0, unassigned: 0 })
    renderPanel()
    expect(await screen.findByText(/You don't manage any businesses yet/)).toBeInTheDocument()
  })

  it('opens a business', async () => {
    const onOpenDetail = vi.fn()
    recordList([])
    renderPanel({ onOpenDetail })
    fireEvent.click(await screen.findByRole('button', { name: 'Open Adwoa Fabrics' }))
    expect(onOpenDetail).toHaveBeenCalledWith(12)
  })

  it('shows the business page for a detail id and goes back to the list', async () => {
    const onOpenDetail = vi.fn()
    server.use(http.get(`${API}/api/portfolio/businesses/12/`, () => HttpResponse.json(detailOf(row()))))
    renderPanel({ detailId: '12', onOpenDetail })
    expect(await screen.findByRole('heading', { name: 'Adwoa Fabrics' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '← Back' }))
    expect(onOpenDetail).toHaveBeenCalledWith(null)
  })
})

describe('PortfolioPanel — all portfolios (Operations)', () => {
  it('defaults to my team, switches to all businesses, shows the summary and offers no export', async () => {
    const urls = []
    recordList(urls)
    renderPanel({ mode: 'all', auth: OPS })
    expect(await screen.findByRole('table', { name: 'Businesses' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'My team' })).toHaveAttribute('aria-pressed', 'true')
    expect(param(urls[0], 'scope')).toBe('team')
    expect(screen.getByText('3 businesses')).toBeInTheDocument()
    expect(screen.getByText('1 without a scout')).toBeInTheDocument()
    expect(screen.getByLabelText('Summary').style.fontVariantNumeric).toBe('tabular-nums')
    expect(screen.queryByRole('button', { name: /Export/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All businesses' }))
    await waitFor(() => expect(urls.some((u) => param(u, 'scope') === 'all')).toBe(true))
  })

  it('filters to businesses with no account manager', async () => {
    const urls = []
    recordList(urls)
    renderPanel({ mode: 'all', auth: OPS })
    fireEvent.click(await screen.findByLabelText('No account manager only'))
    await waitFor(() => expect(urls.some((u) => param(u, 'unassigned') === '1')).toBe(true))
  })

  it('reassigns the selected businesses to a scout on the team, with a reason', async () => {
    const posts = []
    recordList([])
    server.use(
      http.get(`${API}/api/accounts/staff/team/`, () => HttpResponse.json(TEAM)),
      http.post(`${API}/api/portfolio/businesses/:id/reassign/`, async ({ params, request }) => {
        posts.push({ id: params.id, body: await request.json() })
        return HttpResponse.json({ id: Number(params.id) })
      }),
    )
    renderPanel({ mode: 'all', auth: OPS })
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Adwoa Fabrics' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Bantama Cold Store' }))
    expect(screen.getByText('2 selected · Adwoa Fabrics, Bantama Cold Store')).toBeInTheDocument()
    const reassign = screen.getByRole('button', { name: 'Reassign' })
    expect(reassign).toBeDisabled()
    const select = screen.getByLabelText('Reassign to')
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Efua Mensah' })).toBeInTheDocument())
    expect(within(select).queryByRole('option', { name: 'Esi Nyarko' })).not.toBeInTheDocument()
    fireEvent.change(select, { target: { value: '9' } })
    expect(reassign).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Reason (kept on the record)'), { target: { value: 'Efua works the Adum side' } })
    fireEvent.click(reassign)
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[0]).toEqual({ id: '12', body: { scout: 9, reason: 'Efua works the Adum side' } })
    expect(posts[1].id).toBe('14')
    expect(await screen.findByText('Reassigned 2 businesses to Efua Mensah.')).toBeInTheDocument()
  })

  it('keeps a business selected and says why when its reassignment is refused', async () => {
    recordList([], [row()])
    server.use(
      http.get(`${API}/api/accounts/staff/team/`, () => HttpResponse.json(TEAM)),
      http.post(`${API}/api/portfolio/businesses/12/reassign/`, () => HttpResponse.json({ detail: 'You can reassign only between scouts on your team.' }, { status: 403 })),
    )
    renderPanel({ mode: 'all', auth: OPS })
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Adwoa Fabrics' }))
    const select = screen.getByLabelText('Reassign to')
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Efua Mensah' })).toBeInTheDocument())
    fireEvent.change(select, { target: { value: '9' } })
    fireEvent.change(screen.getByLabelText('Reason (kept on the record)'), { target: { value: 'Closer to Efua' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }))
    expect(await screen.findByText('Adwoa Fabrics: You can reassign only between scouts on your team.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Adwoa Fabrics' })).toBeChecked()
  })

  it('offers "Assign a scout" on a business without an account manager', async () => {
    recordList([])
    renderPanel({ mode: 'all', auth: OPS })
    fireEvent.click(await screen.findByRole('button', { name: "Assign a scout to Nana's Chop Bar" }))
    expect(screen.getByText("1 selected · Nana's Chop Bar")).toBeInTheDocument()
  })
})

describe('PortfolioPanel — at risk', () => {
  const AT_RISK = [
    row({
      id: 14, business_name: 'Bantama Cold Store', health: { rating: 'at_risk', reasons: ['Subscription paused'] },
      subscription: { state: 'paused', paused_at: '2026-10-02T00:00:00Z' }, listings_live: 0, listings_total: 6,
    }),
    row({
      id: 16, business_name: 'Kejetia Phone Hub', account_manager: { id: 9, full_name: 'Efua Mensah' },
      health: { rating: 'at_risk', reasons: ['No listing live'] }, subscription: { state: 'active' },
      listings_live: 0, listings_total: 0, last_order_at: '2026-08-18T10:00:00Z',
    }),
  ]

  it('asks only for at-risk businesses and counts them by reason', async () => {
    const urls = []
    recordList(urls, AT_RISK, { ...SUMMARY, at_risk: 2, at_risk_week_ago: 1 })
    renderPanel({ mode: 'at-risk', auth: OPS })
    expect(await screen.findByRole('article', { name: 'Bantama Cold Store' })).toBeInTheDocument()
    expect(param(urls[0], 'health')).toBe('at_risk')
    expect(screen.getByText('2 businesses · 1 a week ago')).toBeInTheDocument()
    const reasons = screen.getByRole('list', { name: 'At-risk reasons' })
    expect(within(reasons).getByText('Paused (1)')).toBeInTheDocument()
    expect(within(reasons).getByText('Nothing live (1)')).toBeInTheDocument()
    expect(within(reasons).getByText('No orders (0)')).toBeInTheDocument()
    expect(within(reasons).getByText('Confirmed fraud (0)')).toBeInTheDocument()
    expect(screen.getByText(/Nobody marks a business at risk by hand/)).toBeInTheDocument()
  })

  it("creates a follow-up task for the business's account manager when they are on my team", async () => {
    let body = null
    recordList([], AT_RISK)
    server.use(
      http.get(`${API}/api/accounts/staff/team/`, () => HttpResponse.json(TEAM)),
      http.post(`${API}/api/portfolio/businesses/16/follow-up/`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )
    renderPanel({ mode: 'at-risk', auth: OPS })
    const card = await screen.findByRole('article', { name: 'Kejetia Phone Hub' })
    fireEvent.click(within(card).getByRole('button', { name: 'Create follow-up task' }))
    await waitFor(() => expect(within(card).getByLabelText('For')).toHaveValue('9'))
    expect(within(within(card).getByLabelText('For')).getByRole('option', { name: 'Me (Ama Boateng)' })).toBeInTheDocument()
    fireEvent.change(within(card).getByLabelText('Task'), { target: { value: 'Visit and help finish the draft listings' } })
    fireEvent.change(within(card).getByLabelText('Due'), { target: { value: '2030-10-09T10:00' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Create task' }))
    await waitFor(() => expect(body).toMatchObject({ owner: 9, title: 'Visit and help finish the draft listings', notes: '' }))
    expect(body.due_at).toBe(new Date('2030-10-09T10:00').toISOString())
    expect(await screen.findByText('Task created for Efua Mensah.')).toBeInTheDocument()
  })

  it('defaults the follow-up to me when the account manager is not on my team', async () => {
    let body = null
    recordList([], AT_RISK)
    server.use(
      http.get(`${API}/api/accounts/staff/team/`, () => HttpResponse.json([{ id: 10, full_name: 'Esi Nyarko', role: 'support', status: 'active' }])),
      http.post(`${API}/api/portfolio/businesses/16/follow-up/`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )
    renderPanel({ mode: 'at-risk', auth: OPS })
    const card = await screen.findByRole('article', { name: 'Kejetia Phone Hub' })
    fireEvent.click(within(card).getByRole('button', { name: 'Create follow-up task' }))
    const select = within(card).getByLabelText('For')
    await waitFor(() => expect(select).toHaveValue('2'))
    expect(within(select).queryByRole('option', { name: 'Efua Mensah' })).not.toBeInTheDocument()
    fireEvent.change(within(card).getByLabelText('Task'), { target: { value: 'Check in on the draft listings' } })
    fireEvent.change(within(card).getByLabelText('Due'), { target: { value: '2030-10-09T10:00' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Create task' }))
    await waitFor(() => expect(body).toMatchObject({ owner: 2 }))
    expect(await screen.findByText('Task created for you.')).toBeInTheDocument()
  })

  it('says so when nothing is at risk', async () => {
    recordList([], [], { ...SUMMARY, at_risk: 0 })
    renderPanel({ mode: 'at-risk', auth: OPS })
    expect(await screen.findByText('No business is at risk right now.')).toBeInTheDocument()
  })
})

describe('PortfolioPanel in the staff shell', () => {
  beforeEach(() => setStoredAuth({ token: 't', account_type: 'staff', id: 7, full_name: 'Kwame Asante' }))
  afterEach(() => setStoredAuth(null))

  it('opens /staff/portfolio/<id> as the business page', async () => {
    server.use(http.get(`${API}/api/portfolio/businesses/12/`, () => HttpResponse.json(detailOf(row()))))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <AdminCommandCenter auth={SCOUT} onExit={vi.fn()} activeTab="portfolio" activeDetail="12" onTabChange={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Adwoa Fabrics' })).toBeInTheDocument()
  })
})
