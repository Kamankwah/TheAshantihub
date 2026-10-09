import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setStoredAuth } from '../../../../apiClient.js'
import { server } from '../../../../mocks/server.js'
import AdminCommandCenter from '../../AdminCommandCenter.jsx'
import SubscriptionsDuePanel from '../SubscriptionsDuePanel.jsx'
import { formatDay, money } from '../portfolioParts.jsx'

const API = 'http://localhost:8000'
const OPS = {
  user: { id: 2, full_name: 'Ama Boateng', role: 'operations', account_type: 'staff' },
  hasPermission: (c) => ['portfolio.manage', 'kyc.approve', 'fraud.manage', 'fraud.flag', 'staff.invite_team'].includes(c),
}
const BOSS = { user: { id: 1, full_name: 'Simon Peter', role: 'super_admin', account_type: 'staff' }, hasPermission: () => true }

const overdueClock = (overrides = {}) => ({
  state: 'overdue', is_trial: false, plan_name: 'Monthly', monthly_price: '120.00',
  current_period_end: '2026-09-24T09:00:00Z', overdue_since: '2026-09-24T09:00:00Z', overdue_day: 13,
  pause_at: '2026-10-08T09:00:00Z', hide_on: '2026-10-08', renew_by: '2026-10-07', paused_at: null,
  ...overrides,
})
const item = (overrides = {}) => ({
  id: 21, business_name: 'Kumasi Leather Works', owner_name: 'Yaa Asantewaa', login_phone: '+233244000221',
  zone: { id: 3, name: 'Adum' }, kyc_status: 'verified', registration_channel: 'scout', needs_claim: false,
  claimed_at: '2026-06-01T10:00:00Z', account_manager: { id: 9, full_name: 'Efua Mensah' },
  health: { rating: 'needs_attention', reasons: ['Subscription overdue'] }, subscription: overdueClock(),
  listings_live: 4, listings_total: 4, listings_waiting: 0, last_order_at: null,
  last_contact: { kind: 'call', at: '2026-10-07T09:05:00Z' }, open_fraud_flags: 0, owner_has_email: true,
  notices: [
    { label: 'Overdue notice', at: '2026-09-24T10:05:00Z' },
    { label: 'Day 7 reminder', at: '2026-09-30T10:05:00Z' },
  ],
  ...overrides,
})
const DUE = {
  overdue: [
    item(),
    item({
      id: 22, business_name: 'Suame Auto Parts', account_manager: null, last_contact: null, notices: [], owner_has_email: false,
      subscription: overdueClock({
        plan_name: 'Quarterly', overdue_since: '2026-10-06T09:00:00Z', overdue_day: 2,
        pause_at: '2026-10-20T09:00:00Z', hide_on: '2026-10-20', renew_by: '2026-10-19',
      }),
    }),
  ],
  paused: [
    item({
      id: 23, business_name: 'Bantama Shoe Palace', account_manager: { id: 7, full_name: 'Kwame Asante' },
      health: { rating: 'at_risk', reasons: ['Subscription paused'] },
      subscription: overdueClock({
        state: 'paused', overdue_since: '2026-09-17T09:00:00Z', overdue_day: null, renew_by: null,
        pause_at: '2026-10-01T09:00:00Z', hide_on: '2026-10-01', paused_at: '2026-10-01T09:00:00Z',
      }),
      notices: [
        { label: 'Overdue notice', at: '2026-09-17T10:05:00Z' },
        { label: 'Day 7 reminder', at: '2026-09-23T10:05:00Z' },
        { label: 'Day 13 reminder', at: '2026-09-29T10:05:00Z' },
      ],
    }),
  ],
  cleared: [{ id: 24, business_name: 'Akosua Ntoma Kente', paid_on_day: 6, at: '2026-10-03T12:00:00Z' }],
}
const scopeOf = (url) => new URL(url).searchParams.get('scope')

function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SubscriptionsDuePanel auth={OPS} onOpenBusiness={() => {}} {...props} />
    </QueryClientProvider>,
  )
}
function recordDue(urls, body = DUE) {
  server.use(http.get(`${API}/api/portfolio/subscriptions-due/`, ({ request }) => {
    urls.push(request.url)
    return HttpResponse.json(body)
  }))
}

describe('SubscriptionsDuePanel', () => {
  it('shows the clock, the honest chips and the overdue businesses, most urgent first', async () => {
    const urls = []
    recordDue(urls)
    renderPanel()
    const table = await screen.findByRole('table', { name: 'Overdue subscriptions' })
    expect(scopeOf(urls[0])).toBe('team')
    expect(screen.getByText('Payments are simulated until Hubtel is connected')).toBeInTheDocument()
    expect(screen.getByText('Owners pay in the app · scouts never collect cash')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'The overdue clock' })).toBeInTheDocument()
    expect(screen.getByText('2 businesses · most urgent first')).toBeInTheDocument()
    expect(within(table).getAllByText(/^(Kumasi Leather Works|Suame Auto Parts)$/).map((el) => el.textContent))
      .toEqual(['Kumasi Leather Works', 'Suame Auto Parts'])

    const kumasi = within(table).getByRole('row', { name: /Kumasi Leather Works/ })
    expect(within(kumasi).getByText(`Monthly plan · ${money('120.00')} / month · overdue since ${formatDay('2026-09-24T09:00:00Z')}`)).toBeInTheDocument()
    expect(within(kumasi).getByText('Day 13 of 14')).toBeInTheDocument()
    expect(within(kumasi).getByText(`Listings hidden from ${formatDay('2026-10-08')} if still unpaid`)).toBeInTheDocument()
    expect(within(kumasi).getByText(`Overdue notice · ${formatDay('2026-09-24T10:05:00Z')}`)).toBeInTheDocument()
    expect(within(kumasi).getByText(`Day 7 reminder · ${formatDay('2026-09-30T10:05:00Z')}`)).toBeInTheDocument()
    expect(within(kumasi).getByText('In-app and email · SMS: not connected')).toBeInTheDocument()
    expect(within(kumasi).getByText('Efua Mensah')).toBeInTheDocument()

    const suame = within(table).getByRole('row', { name: /Suame Auto Parts/ })
    expect(within(suame).getByText('Day 2 of 14')).toBeInTheDocument()
    expect(within(suame).getByText('None sent yet')).toBeInTheDocument()
    // No email on file: the clock's notices reach this owner in the app only.
    expect(within(suame).getByText('In-app only · SMS: not connected')).toBeInTheDocument()
    expect(within(suame).queryByText('In-app and email · SMS: not connected')).not.toBeInTheDocument()
    expect(within(suame).getByText('No account manager')).toBeInTheDocument()
  })

  it('lists the paused businesses and the ones cleared this week', async () => {
    recordDue([])
    renderPanel()
    const paused = await screen.findByRole('table', { name: 'Paused subscriptions' })
    const shoes = within(paused).getByRole('row', { name: /Bantama Shoe Palace/ })
    expect(within(shoes).getByText(`Paused since ${formatDay('2026-10-01T09:00:00Z')}`)).toBeInTheDocument()
    expect(within(shoes).getByText('Listings and events hidden — not deleted')).toBeInTheDocument()
    expect(within(shoes).getByText(`Day 13 reminder · ${formatDay('2026-09-29T10:05:00Z')}`)).toBeInTheDocument()
    expect(within(shoes).getByText('Kwame Asante')).toBeInTheDocument()
    expect(screen.getByText('Reversible: the moment the owner pays in the app, the pause lifts and the listings reappear.')).toBeInTheDocument()
    const cleared = screen.getByRole('list', { name: 'Cleared this week' })
    expect(within(cleared).getByText(`Akosua Ntoma Kente — paid in the app on day 6 (${formatDay('2026-10-03T12:00:00Z')})`)).toBeInTheDocument()
  })

  it('explains the pause when the server says it is on', async () => {
    recordDue([], { ...DUE, pause_enabled: true })
    renderPanel()
    expect(await screen.findByRole('table', { name: 'Paused subscriptions' })).toBeInTheDocument()
    expect(screen.getByText('After day 14 · paused')).toBeInTheDocument()
    expect(screen.queryByText(/Pausing is switched off/)).not.toBeInTheDocument()
  })

  it('with the pause switched off, says so and drops the hiding line and the Paused section', async () => {
    const off = { pause_enabled: false, overdue_day: 21, pause_at: null, hide_on: null, renew_by: null }
    recordDue([], {
      pause_enabled: false,
      overdue: [item({ subscription: overdueClock(off) })],
      paused: [],
      cleared: DUE.cleared,
    })
    renderPanel()
    const table = await screen.findByRole('table', { name: 'Overdue subscriptions' })
    expect(screen.getByText('Pausing is switched off — overdue businesses stay visible. Owners get reminders on day 7 and day 13.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Overdue · listings stay visible' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Overdue' })).toBeInTheDocument()
    const kumasi = within(table).getByRole('row', { name: /Kumasi Leather Works/ })
    expect(within(kumasi).getByText('Overdue · day 21')).toBeInTheDocument()
    expect(within(kumasi).getByText(`Monthly plan · ${money('120.00')} / month · overdue since ${formatDay('2026-09-24T09:00:00Z')}`)).toBeInTheDocument()
    expect(screen.queryByText(/Listings hidden from/)).not.toBeInTheDocument()
    expect(screen.queryByText(/of 14/)).not.toBeInTheDocument()
    expect(screen.queryByText(/hidden/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Paused/ })).not.toBeInTheDocument()
    expect(screen.queryByText('No business is paused.')).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Cleared this week' })).toBeInTheDocument()
  })

  it('says so when nothing is due', async () => {
    renderPanel()
    expect(await screen.findByText('No subscription is overdue right now.')).toBeInTheDocument()
    expect(screen.getByText('No business is paused.')).toBeInTheDocument()
    expect(screen.getByText('No overdue subscription was paid in the last 7 days.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('switches between my team and all businesses', async () => {
    const urls = []
    recordDue(urls)
    renderPanel()
    const all = await screen.findByRole('button', { name: 'All businesses' })
    expect(screen.getByRole('button', { name: 'My team' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(all)
    await waitFor(() => expect(urls.map(scopeOf)).toContain('all'))
    expect(screen.getByRole('button', { name: 'All businesses' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('starts a Super Admin on all businesses', async () => {
    const urls = []
    recordDue(urls)
    renderPanel({ auth: BOSS })
    await waitFor(() => expect(urls.length).toBeGreaterThan(0))
    expect(scopeOf(urls[0])).toBe('all')
  })

  it("creates a follow-up task for the business's account manager", async () => {
    let body = null
    recordDue([])
    server.use(
      // FollowUpForm offers the account manager only when they report to the caller.
      http.get(`${API}/api/accounts/staff/team/`, () => HttpResponse.json([{ id: 9, full_name: 'Efua Mensah' }])),
      http.post(`${API}/api/portfolio/businesses/21/follow-up/`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Create follow-up task for Kumasi Leather Works' }))
    await waitFor(() => expect(screen.getByLabelText('For')).toHaveValue('9'))
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Call Yaa before the pause on day 14' } })
    fireEvent.change(screen.getByLabelText('Due'), { target: { value: '2030-10-09T10:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    await waitFor(() => expect(body).toMatchObject({ owner: 9, title: 'Call Yaa before the pause on day 14', notes: '' }))
    expect(body.due_at).toBe(new Date('2030-10-09T10:00').toISOString())
    expect(await screen.findByRole('status')).toHaveTextContent('Task created for Efua Mensah.')
  })

  it('opens a business', async () => {
    const onOpenBusiness = vi.fn()
    recordDue([])
    renderPanel({ onOpenBusiness })
    fireEvent.click(await screen.findByRole('button', { name: 'Open Suame Auto Parts' }))
    expect(onOpenBusiness).toHaveBeenCalledWith(22)
  })

  it('offers a retry when the list fails to load', async () => {
    let gets = 0
    server.use(http.get(`${API}/api/portfolio/subscriptions-due/`, () => {
      gets += 1
      return gets === 1 ? HttpResponse.json({ detail: 'boom' }, { status: 500 }) : HttpResponse.json(DUE)
    }))
    renderPanel()
    expect(await screen.findByText('Could not load subscriptions due.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table', { name: 'Overdue subscriptions' })).toBeInTheDocument()
  })
})

describe('Subscriptions due in the staff shell', () => {
  beforeEach(() => setStoredAuth({ token: 't', account_type: 'staff', id: 2, full_name: 'Ama Boateng' }))
  afterEach(() => setStoredAuth(null))

  it('opens a business on its All portfolios page', async () => {
    recordDue([])
    const onTabChange = vi.fn()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <AdminCommandCenter auth={OPS} onExit={vi.fn()} activeTab="subscriptions-due" onTabChange={onTabChange} />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Open Kumasi Leather Works' }))
    expect(onTabChange).toHaveBeenCalledWith('all-portfolios/21')
  })
})
