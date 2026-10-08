import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setStoredAuth } from '../../../../apiClient.js'
import { server } from '../../../../mocks/server.js'
import AdminCommandCenter from '../../AdminCommandCenter.jsx'
import FraudCasesPanel from '../FraudCasesPanel.jsx'
import { formatDateTime } from '../portfolioParts.jsx'

const API = 'http://localhost:8000'
const OPS = {
  user: { id: 2, full_name: 'Ama Boateng', role: 'operations', account_type: 'staff' },
  hasPermission: (c) => ['fraud.manage', 'fraud.flag', 'portfolio.manage', 'users.view'].includes(c),
}
const SUPPORT = {
  user: { id: 10, full_name: 'Esi Nyarko', role: 'support', account_type: 'staff' },
  hasPermission: (c) => ['fraud.flag', 'users.view', 'messaging.manage'].includes(c),
}

const flag = (overrides = {}) => ({
  id: 5, kind: 'duplicate', kind_label: 'Duplicate registration', status: 'open', source: 'system',
  title: 'Suame Spare Parts Centre and Suame Auto Parts share a MoMo number',
  detail: 'When its owner added payout details after KYC, the number matched Suame Auto Parts.',
  evidence: ['Payout MoMo number 024 *** 390 on both', 'Map pins 22 m apart on the same street'],
  business_owner: { id: 31, display_name: 'Suame Spare Parts Centre', account_manager_name: 'Kwaku Agyei' },
  related_business_owner: { id: 32, display_name: 'Suame Auto Parts' },
  staff_subject: null, raised_by_name: null, created_at: '2026-10-08T08:46:00Z',
  resolved_by_name: null, resolved_at: null, resolution_note: '', can_suspend: true,
  ...overrides,
})
const DUPLICATE = flag()
const SELF_DEALING = flag({
  id: 6, kind: 'self_dealing', kind_label: 'Self-dealing', title: 'Nhyiaeso Car Wash · owner phone matches a staff member',
  detail: "The owner phone given is the phone on Kofi Boadu's own staff profile.", evidence: ['Owner name given: “Kofi B. Mensah”'],
  business_owner: { id: 33, display_name: 'Nhyiaeso Car Wash', account_manager_name: null }, related_business_owner: null,
  staff_subject: { id: 14, full_name: 'Kofi Boadu' }, created_at: '2026-10-03T16:20:00Z',
})
const page = (results) => ({ count: results.length, next: null, previous: null, results })

function mockCases({ open = [DUPLICATE, SELF_DEALING], confirmed = [], dismissed = [], counts = { open: 2, confirmed: 1, dismissed: 0 } } = {}) {
  const hits = { list: [] }
  const lists = { open, confirmed, dismissed }
  server.use(
    http.get(`${API}/api/fraud/flags/counts/`, () => HttpResponse.json(counts)),
    http.get(`${API}/api/fraud/flags/`, ({ request }) => {
      hits.list.push(request.url)
      return HttpResponse.json(page(lists[new URL(request.url).searchParams.get('status')] || []))
    }),
  )
  return hits
}
function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <FraudCasesPanel auth={OPS} onOpenBusiness={() => {}} {...props} />
    </QueryClientProvider>,
  )
}

describe('FraudCasesPanel — Operations', () => {
  it('lists the open cases with kind, who raised them, evidence and the counts', async () => {
    const hits = mockCases()
    renderPanel()
    const card = await screen.findByRole('article', { name: DUPLICATE.title })
    expect(new URL(hits.list[0]).searchParams.get('status')).toBe('open')
    expect(within(card).getByText('Duplicate registration')).toBeInTheDocument()
    expect(within(card).getByText(`Raised by the system · ${formatDateTime('2026-10-08T08:46:00Z')}`)).toBeInTheDocument()
    expect(within(card).getByText(DUPLICATE.detail)).toBeInTheDocument()
    expect(within(card).getByText('Business: Suame Spare Parts Centre · account manager Kwaku Agyei')).toBeInTheDocument()
    expect(within(card).getByText('Also involved: Suame Auto Parts')).toBeInTheDocument()
    const evidence = within(card).getByRole('list', { name: 'Evidence' })
    expect(within(evidence).getAllByRole('listitem').map((li) => li.textContent)).toEqual(DUPLICATE.evidence)

    const hold = screen.getByRole('article', { name: SELF_DEALING.title })
    expect(within(hold).getByText('Its KYC request is on hold until this case is decided.')).toBeInTheDocument()
    expect(within(hold).getByText('About a staff member: Kofi Boadu')).toBeInTheDocument()
    expect(within(hold).getByRole('checkbox', { name: 'Suspend Nhyiaeso Car Wash' })).toBeInTheDocument()

    expect(await screen.findByRole('button', { name: 'Open · 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Confirmed · 1' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Dismissed · 0' })).toBeInTheDocument()
  })

  it('confirms a case with a note and suspends the business', async () => {
    const hits = mockCases()
    let body = null
    server.use(http.post(`${API}/api/fraud/flags/5/confirm/`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json(flag({ status: 'confirmed', can_suspend: false }))
    }))
    renderPanel()
    const card = await screen.findByRole('article', { name: DUPLICATE.title })
    const confirm = within(card).getByRole('button', { name: 'Confirm fraud' })
    expect(confirm).toBeDisabled()
    expect(within(card).getByText('Write a note to confirm or dismiss.')).toBeInTheDocument()
    fireEvent.change(within(card).getByLabelText('Note (required)'), { target: { value: 'Called both owners — the same person runs both' } })
    fireEvent.click(within(card).getByRole('checkbox', { name: 'Suspend Suame Spare Parts Centre' }))
    fireEvent.click(confirm)
    await waitFor(() => expect(body).toEqual({ note: 'Called both owners — the same person runs both', suspend: true }))
    expect(await screen.findByRole('status')).toHaveTextContent(`Confirmed: ${DUPLICATE.title} — Suame Spare Parts Centre is suspended.`)
    await waitFor(() => expect(hits.list.length).toBeGreaterThanOrEqual(2))
  })

  it('offers no suspend checkbox when the case cannot suspend, and dismisses with a note', async () => {
    const objection = flag({
      id: 9, kind: 'owner_objected', kind_label: 'Owner said “This wasn\'t me”', source: 'owner',
      title: 'Tafo Grains & Provisions · 3 photos undone by the owner', related_business_owner: null, can_suspend: false,
      business_owner: { id: 34, display_name: 'Tafo Grains & Provisions', account_manager_name: 'Abena Darko' },
    })
    mockCases({ open: [objection], counts: { open: 1, confirmed: 0, dismissed: 0 } })
    let body = null
    server.use(http.post(`${API}/api/fraud/flags/9/dismiss/`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ...objection, status: 'dismissed' })
    }))
    renderPanel()
    const card = await screen.findByRole('article', { name: objection.title })
    expect(within(card).getByText('Raised by the owner · ' + formatDateTime(objection.created_at))).toBeInTheDocument()
    expect(within(card).queryByRole('checkbox')).not.toBeInTheDocument()
    fireEvent.change(within(card).getByLabelText('Note (required)'), { target: { value: "The owner's son agreed — photos can be sent again" } })
    fireEvent.click(within(card).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(body).toEqual({ note: "The owner's son agreed — photos can be sent again" }))
    expect(await screen.findByRole('status')).toHaveTextContent('Dismissed: Tafo Grains & Provisions · 3 photos undone by the owner.')
  })

  it.each([
    ['confirm', 'Confirm fraud', 400, 'This case has already been decided.'],
    ['dismiss', 'Dismiss', 403, 'A case about you is decided by someone else.'],
    ['confirm', 'Confirm fraud', 400, "This kind of case can't suspend a business."],
  ])("shows the server's reason when %s is refused (%s, %i)", async (action, buttonName, statusCode, message) => {
    mockCases()
    server.use(http.post(`${API}/api/fraud/flags/5/${action}/`, () => HttpResponse.json({ detail: message }, { status: statusCode })))
    renderPanel()
    const card = await screen.findByRole('article', { name: DUPLICATE.title })
    fireEvent.change(within(card).getByLabelText('Note (required)'), { target: { value: 'Checked with the scout' } })
    if (action === 'confirm') fireEvent.click(within(card).getByRole('checkbox', { name: 'Suspend Suame Spare Parts Centre' }))
    fireEvent.click(within(card).getByRole('button', { name: buttonName }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('never offers a decision on a case about the viewer', async () => {
    const aboutAma = flag({
      id: 8, kind: 'outside_radius', kind_label: 'Repeated outside-radius check-ins',
      title: 'Ama Boateng · 3 check-ins over 100 m from the business', business_owner: null,
      related_business_owner: null, staff_subject: { id: 2, full_name: 'Ama Boateng' }, can_suspend: false, evidence: [],
    })
    mockCases({ open: [aboutAma], counts: { open: 1, confirmed: 0, dismissed: 0 } })
    renderPanel()
    const card = await screen.findByRole('article', { name: aboutAma.title })
    expect(within(card).getByText('This case is about you — someone else decides it.')).toBeInTheDocument()
    expect(within(card).getByText('About a staff member: Ama Boateng')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
    expect(within(card).queryByLabelText('Note (required)')).not.toBeInTheDocument()
  })

  it('shows decided cases with the decision and its note', async () => {
    const decided = flag({
      id: 7, status: 'confirmed', title: 'Kejetia Beads & Crafts registered twice', resolved_by_name: 'Ama Boateng',
      resolved_at: '2026-10-06T15:00:00Z', resolution_note: 'Same shop front', can_suspend: false,
    })
    mockCases({ confirmed: [decided] })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmed · 1' }))
    const card = await screen.findByRole('article', { name: decided.title })
    expect(within(card).getByText(`Confirmed by Ama Boateng · ${formatDateTime('2026-10-06T15:00:00Z')}: “Same shop front”`)).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Confirm fraud' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmed · 1' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('says so when there are no cases', async () => {
    renderPanel()
    expect(await screen.findByText('No open cases.')).toBeInTheDocument()
  })

  it('opens the business a case is about', async () => {
    mockCases()
    const onOpenBusiness = vi.fn()
    renderPanel({ onOpenBusiness })
    fireEvent.click(await screen.findByRole('button', { name: 'Open Suame Auto Parts' }))
    expect(onOpenBusiness).toHaveBeenCalledWith(32)
  })
})

describe('FraudCasesPanel — raising a case', () => {
  const OWNER_ROW = {
    id: 31, full_name: 'Kojo Mensah', business_name: 'Suame Spare Parts Centre', login_phone: '+233244003390',
    email: '', kyc_status: 'verified', is_suspended: false, created_at: '2026-09-30T10:00:00Z',
  }

  it('raises a case about a business found by search', async () => {
    mockCases({ open: [], counts: { open: 0, confirmed: 0, dismissed: 0 } })
    const searches = []
    let body = null
    server.use(
      http.get(`${API}/api/accounts/business-owners/`, ({ request }) => {
        searches.push(new URL(request.url).searchParams.get('search'))
        return HttpResponse.json(page([OWNER_ROW]))
      }),
      http.post(`${API}/api/fraud/flags/`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(flag({ id: 12, kind: 'fake_business', kind_label: 'Fake business', source: 'staff', raised_by_name: 'Ama Boateng', title: body.title, related_business_owner: null }), { status: 201 })
      }),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Raise a case' }))
    const form = screen.getByRole('form', { name: 'Raise a case' })
    expect(within(form).getByLabelText('Kind')).toHaveValue('fake_business')
    fireEvent.change(within(form).getByLabelText('Find the business'), { target: { value: 'suame' } })
    await waitFor(() => expect(searches).toContain('suame'))
    await within(form).findByRole('option', { name: 'Suame Spare Parts Centre · Kojo Mensah · +233244003390' })
    fireEvent.change(within(form).getByLabelText('Business'), { target: { value: '31' } })
    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'Signboard photo is of another shop' } })
    fireEvent.change(within(form).getByLabelText('What happened'), { target: { value: 'A customer reported the shop does not exist.' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Raise case' }))
    await waitFor(() => expect(body).toEqual({
      kind: 'fake_business', title: 'Signboard photo is of another shop',
      detail: 'A customer reported the shop does not exist.', business_owner: 31,
    }))
    expect(await screen.findByRole('status')).toHaveTextContent('Case raised: Signboard photo is of another shop. Operations has been told.')
  })

  it("shows the server's reason when raising is refused", async () => {
    mockCases({ open: [], counts: { open: 0, confirmed: 0, dismissed: 0 } })
    server.use(http.post(`${API}/api/fraud/flags/`, () => HttpResponse.json(
      { business_owner: ['Choose the business this case is about.'] }, { status: 400 },
    )))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Raise a case' }))
    const form = screen.getByRole('form', { name: 'Raise a case' })
    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'Shop not where the pin says' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Raise case' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('Choose the business this case is about.')
  })

  it('shows Support only the Raise-a-case form and the cases they raised', async () => {
    const mine = flag({
      id: 11, kind: 'fake_business', kind_label: 'Fake business', source: 'staff', raised_by_name: 'Esi Nyarko',
      title: 'Customer says Adum Phones is not a real shop', related_business_owner: null,
      business_owner: { id: 12, display_name: 'Adum Phones', account_manager_name: 'Kwame Asante' },
    })
    mockCases({ open: [mine], counts: { open: 1, confirmed: 0, dismissed: 0 } })
    renderPanel({ auth: SUPPORT, onOpenBusiness: vi.fn() })
    const card = await screen.findByRole('article', { name: mine.title })
    expect(screen.getByText('You can raise a case about a business. Operations decides it; here you see the cases you raised.')).toBeInTheDocument()
    expect(within(card).getByText(`Raised by Esi Nyarko · ${formatDateTime(mine.created_at)}`)).toBeInTheDocument()
    expect(within(card).queryByLabelText('Note (required)')).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Confirm fraud' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Open Adum Phones' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Raise a case' })).toBeInTheDocument()
  })
})

describe('Fraud cases in the staff shell', () => {
  beforeEach(() => setStoredAuth({ token: 't', account_type: 'staff', id: 2, full_name: 'Ama Boateng' }))
  afterEach(() => setStoredAuth(null))

  it('opens the business on its All portfolios page', async () => {
    mockCases()
    const onTabChange = vi.fn()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <AdminCommandCenter auth={OPS} onExit={vi.fn()} activeTab="fraud-cases" onTabChange={onTabChange} />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Open Suame Spare Parts Centre' }))
    expect(onTabChange).toHaveBeenCalledWith('all-portfolios/31')
  })
})
