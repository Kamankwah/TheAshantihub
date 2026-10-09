import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import BusinessPage from '../BusinessPage.jsx'
import { formatDay, money } from '../portfolioParts.jsx'

// The hand-over itself is Task 11's OwnerHandover (tested there); here it is a
// stub that shows what it was given and can finish.
vi.mock('../OwnerHandover.jsx', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ businessId, ownerFirstName, scoutName, onDone }) => createElement(
      'div', { role: 'dialog', 'aria-label': 'Owner hand-over' },
      `Hand-over ${businessId} for ${ownerFirstName} from ${scoutName}`,
      createElement('button', { type: 'button', onClick: onDone }, 'Finish hand-over'),
    ),
  }
})
const geo = vi.hoisted(() => ({ locate: vi.fn(), position: null }))
vi.mock('../../../../hooks/useDevicePosition.js', () => ({
  useDevicePosition: () => ({ position: geo.position, error: null, locating: false, locate: geo.locate }),
}))

const API = 'http://localhost:8000'
const SCOUT = {
  user: { id: 7, full_name: 'Kwame Asante', role: 'scout' },
  hasPermission: (c) => ['businesses.manage_portfolio', 'businesses.register', 'calls.log'].includes(c),
}
const OPS = {
  user: { id: 2, full_name: 'Ama Boateng', role: 'operations' },
  hasPermission: (c) => ['portfolio.manage', 'calls.log', 'staff.invite_team'].includes(c),
}
const BOSS = { user: { id: 1, full_name: 'Simon Peter', role: 'super_admin' }, hasPermission: () => true }
const business = (overrides = {}) => ({
  id: 12, business_name: 'Adwoa Fabrics', owner_name: 'Adwoa Frimpong', login_phone: '+233244000118',
  zone: { id: 3, name: 'Bantama' }, kyc_status: 'verified', registration_channel: 'scout', needs_claim: false,
  claimed_at: '2026-08-12T10:00:00Z', account_manager: { id: 7, full_name: 'Kwame Asante' },
  health: { rating: 'needs_attention', reasons: ['Subscription overdue'] },
  subscription: {
    state: 'overdue', is_trial: false, plan_name: 'Monthly', monthly_price: '120.00', current_period_end: '2026-10-04T00:00:00Z',
    overdue_since: '2026-10-04T00:00:00Z', overdue_day: 4, pause_at: '2026-10-18T00:00:00Z', hide_on: '2026-10-18',
    renew_by: '2026-10-17', paused_at: null,
  },
  listings_live: 1, listings_total: 1, listings_waiting: 0, last_order_at: '2026-10-02T10:00:00Z',
  last_contact: { kind: 'call', at: '2026-10-07T16:10:00Z' }, open_fraud_flags: 0,
  business_kind: 'product', business_category: { id: 2, name: 'Fabrics & clothing' }, gps_address: 'AK-087-2210',
  lat: '6.700000', lng: '-1.620000', location_accuracy_m: 9, location_is_manual: false, location_set_by: 'scout',
  business_contact_phone: '+233244000118', business_description: 'Wax prints and kente', opening_hours: 'Mon–Sat 08:00–18:00',
  signboard_photo: null, email: '', registered_by: { id: 7, full_name: 'Kwame Asante' }, created_at: '2026-08-10T09:00:00Z',
  listings: [{ id: 40, name: 'Ankara wrap skirt', status: 'published', main_photo: null, photos_count: 2, price_amount: '180.00' }],
  pending_requests: [], recent_calls: [], assignments: [], open_flags: [], can_manage: true,
  ...overrides,
})

function serve(b = business()) {
  let gets = 0
  server.use(http.get(`${API}/api/portfolio/businesses/12/`, () => { gets += 1; return HttpResponse.json(b) }))
  return () => gets
}
function renderPage(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <BusinessPage businessId="12" auth={SCOUT} onBack={() => {}} {...props} />
    </QueryClientProvider>,
  )
}

describe('BusinessPage', () => {
  it('shows health, the overdue clock and the no-cash rule', async () => {
    serve()
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Adwoa Fabrics' })).toBeInTheDocument()
    const health = screen.getByRole('region', { name: 'Health' })
    expect(within(health).getByText('Subscription overdue')).toBeInTheDocument()
    expect(within(health).getByText(/Overdue · day 4 of 14 · GH₵ 120\.00 \/ month/)).toBeInTheDocument()
    expect(within(health).getByText(/if still unpaid\. Adwoa pays in the app — scouts never collect cash\./)).toBeInTheDocument()
  })

  it('with the pause switched off, shows overdue since a date with no hide date or grace bar', async () => {
    serve(business({
      subscription: {
        state: 'overdue', is_trial: false, plan_name: 'Monthly', monthly_price: '120.00', current_period_end: '2026-10-04T00:00:00Z',
        overdue_since: '2026-10-04T00:00:00Z', overdue_day: 21, pause_at: null, hide_on: null, renew_by: null, paused_at: null,
        pause_enabled: false,
      },
    }))
    renderPage()
    const health = await screen.findByRole('region', { name: 'Health' })
    expect(within(health).getByText(`Subscription · Overdue since ${formatDay('2026-10-04T00:00:00Z')} · ${money('120.00')} / month`)).toBeInTheDocument()
    expect(within(health).getByText('Adwoa pays in the app — scouts never collect cash.')).toBeInTheDocument()
    expect(within(health).queryByText(/hidden|of 14/)).not.toBeInTheDocument()
    expect(within(health).queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('keeps the grace bar and the hide date when the pause is on', async () => {
    const b = business()
    serve(business({ subscription: { ...b.subscription, pause_enabled: true } }))
    renderPage()
    const health = await screen.findByRole('region', { name: 'Health' })
    expect(within(health).getByRole('progressbar', { name: 'Grace days used' })).toBeInTheDocument()
    expect(within(health).getByText(/Listings are hidden on .* if still unpaid\./)).toBeInTheDocument()
  })

  it('logs a call that counts as contact with this business', async () => {
    let body = null
    const gets = serve()
    server.use(
      http.get(`${API}/api/calls/purposes/`, () => HttpResponse.json([{ value: 'subscription_payment', label: 'Subscription payment' }, { value: 'other', label: 'Other' }])),
      http.post(`${API}/api/calls/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 1 }, { status: 201 }) }),
    )
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Log a call' }))
    await screen.findByRole('option', { name: 'Subscription payment' })
    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'subscription_payment' } })
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'promised_to_pay' } })
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Will pay Friday' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save call' }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toMatchObject({
      direction: 'out', channel: 'phone',
      counterpart_type: 'business_owner', counterpart_id: 12, counterpart_name: 'Adwoa Frimpong', counterpart_phone: '+233244000118',
      related_type: 'business_owner', related_id: '12', related_label: 'Adwoa Fabrics',
      purpose: 'subscription_payment', outcome: 'promised_to_pay', notes: 'Will pay Friday',
    })
    expect(await screen.findByText('Call saved.')).toBeInTheDocument()
    await waitFor(() => expect(gets()).toBeGreaterThanOrEqual(2))
  })

  it('says the claim link is not needed once the owner has a login', async () => {
    serve()
    renderPage()
    expect(await screen.findByRole('button', { name: 'Resend claim link' })).toBeDisabled()
    expect(screen.getByText(/Claim link not needed — Adwoa set their own login on/)).toBeInTheDocument()
  })

  it('hands the phone to the owner while the business has no login yet', async () => {
    const gets = serve(business({ needs_claim: true, claimed_at: null }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Hand the phone to Adwoa' }))
    const dialog = screen.getByRole('dialog', { name: 'Owner hand-over' })
    expect(dialog).toHaveTextContent('Hand-over 12 for Adwoa from Kwame Asante')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Finish hand-over' }))
    expect(screen.queryByRole('dialog', { name: 'Owner hand-over' })).not.toBeInTheDocument()
    await waitFor(() => expect(gets()).toBeGreaterThanOrEqual(2))
  })

  it('sends a claim link and says where it went', async () => {
    serve(business({ needs_claim: true, claimed_at: null }))
    server.use(http.post(`${API}/api/portfolio/businesses/12/claim-link/`, () => HttpResponse.json({ sent_to: 'a•••@example.com', expires_at: '2026-10-15T10:00:00Z' })))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Send claim link' }))
    expect(await screen.findByText(/Link sent to a•••@example\.com/)).toBeInTheDocument()
  })

  it('points to Propose a change when there is no email for the claim link', async () => {
    serve(business({ needs_claim: true, claimed_at: null, email: '' }))
    renderPage()
    expect(await screen.findByText(/no email on file for Adwoa.*Add one with Propose a change/)).toBeInTheDocument()
  })

  it("shows the server's reason when a claim link can't be sent", async () => {
    serve(business({ needs_claim: true, claimed_at: null }))
    server.use(http.post(`${API}/api/portfolio/businesses/12/claim-link/`, () => HttpResponse.json({ detail: "Add the owner's email first — text messages (SMS) aren't connected yet." }, { status: 400 })))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Send claim link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Add the owner's email first — text messages (SMS) aren't connected yet.")
  })

  it('gives the account manager the change, product and photo screens', async () => {
    serve(business({ subscription: { state: 'active', plan_name: 'Monthly', monthly_price: '120.00', current_period_end: '2026-11-04T00:00:00Z' } }))
    renderPage()
    expect(await screen.findByRole('button', { name: 'Add photos' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Add a product' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Propose a change' }))
    expect(await screen.findByRole('heading', { name: 'Propose a change' })).toBeInTheDocument()
  })

  it('keeps Add a product closed until KYC is approved', async () => {
    serve(business({ kyc_status: 'pending' }))
    renderPage()
    expect(await screen.findByRole('button', { name: 'Add a product' })).toBeDisabled()
    expect(screen.getByText('Products can be added once KYC is approved.')).toBeInTheDocument()
  })

  it.each([
    ['overdue', { state: 'overdue', overdue_day: 4 }],
    ['paused', { state: 'paused' }],
    ['absent', { state: 'none' }],
  ])('keeps Add a product closed while the subscription is %s, and says why', async (_name, subscription) => {
    serve(business({ subscription }))
    renderPage()
    expect(await screen.findByRole('button', { name: 'Add a product' })).toBeDisabled()
    expect(screen.getByText('Products can be added once Adwoa has an active subscription.')).toBeInTheDocument()
    expect(screen.queryByText('Products can be added once KYC is approved.')).not.toBeInTheDocument()
  })

  it('opens Add a product for a business on a trial', async () => {
    serve(business({ subscription: { state: 'trial', is_trial: true } }))
    renderPage()
    expect(await screen.findByRole('button', { name: 'Add a product' })).toBeEnabled()
  })

  it('lists what is waiting for approval', async () => {
    serve(business({
      pending_requests: [{
        id: 31, kind: 'business.update', title: 'Adwoa Fabrics', created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        due_at: new Date(Date.now() + 22 * 3600 * 1000).toISOString(), stage: 'manager', waiting_for: 'Ama Boateng',
      }],
    }))
    renderPage()
    const waiting = await screen.findByRole('region', { name: 'Waiting for approval' })
    expect(within(waiting).getByText('Business details change')).toBeInTheDocument()
    expect(within(waiting).getByText(/waiting for Ama Boateng/)).toBeInTheDocument()
  })

  it('gives Operations reassignment, follow-up and the assignment history, not the scout tools', async () => {
    serve(business({
      can_manage: false,
      assignments: [{ scout_name: 'Kwame Asante', assigned_by_name: null, reason: '', started_at: '2026-08-10T09:00:00Z', ended_at: null }],
    }))
    renderPage({ auth: OPS })
    expect(await screen.findByRole('button', { name: 'Reassign to another scout' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create follow-up task' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Propose a change' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Assignment history' })).getByText(/Kwame Asante/)).toBeInTheDocument()
  })

  it('says a missing business is missing', async () => {
    server.use(http.get(`${API}/api/portfolio/businesses/12/`, () => HttpResponse.json({ detail: 'Not found.' }, { status: 404 })))
    renderPage()
    expect(await screen.findByText("This business doesn't exist, or isn't one you can see.")).toBeInTheDocument()
  })
})

describe('BusinessPage — open fraud cases', () => {
  it("shows a scout only a case's kind, and Operations its title too", async () => {
    serve(business({ open_flags: [{ id: 5, kind: 'self_dealing', kind_label: 'Self-dealing' }] }))
    renderPage()
    const chip = await screen.findByText('🚩 Self-dealing')
    expect(chip).not.toHaveAttribute('title')
  })

  it('gives Operations the title as the tooltip', async () => {
    serve(business({ can_manage: false, open_flags: [{ id: 5, kind: 'self_dealing', kind_label: 'Self-dealing', title: "Owner's phone matches staff member Efua" }] }))
    renderPage({ auth: OPS })
    expect(await screen.findByText('🚩 Self-dealing')).toHaveAttribute('title', "Owner's phone matches staff member Efua")
  })
})

describe('BusinessPage — numbers line up', () => {
  it('sets prices, the plan price and the grace day in tabular figures', async () => {
    serve()
    renderPage()
    const listings = await screen.findByRole('region', { name: 'Listings and photos' })
    expect(within(listings).getByText(/GH₵ 180\.00/).style.fontVariantNumeric).toBe('tabular-nums')
    const health = screen.getByRole('region', { name: 'Health' })
    expect(within(health).getByText(/Overdue · day 4 of 14 · GH₵ 120\.00 \/ month/).style.fontVariantNumeric).toBe('tabular-nums')
  })
})

describe('BusinessPage — sending KYC again', () => {
  // A scout registration whose business.kyc request Operations returned.
  const returned = (overrides = {}) => business({ kyc_status: 'pending', subscription: { state: 'none' }, pending_requests: [], ...overrides })
  const KYC_URL = `${API}/api/portfolio/businesses/12/kyc/`
  let append
  beforeEach(() => { append = vi.spyOn(FormData.prototype, 'append') })
  afterEach(() => append.mockRestore())

  // Reading a multipart body that holds a jsdom File hangs here (see
  // EventSubmissionPanel.test.jsx), so the handler records only the content
  // type; the fields come from FormData.prototype.append.
  function answerKyc(reply) {
    const seen = { calls: 0, contentType: null }
    server.use(http.post(KYC_URL, ({ request }) => {
      seen.calls += 1
      seen.contentType = request.headers.get('content-type')
      return HttpResponse.json(reply, { status: 201 })
    }))
    return seen
  }

  it('offers it to the account manager when no KYC request is waiting', async () => {
    serve(returned())
    renderPage()
    expect(await screen.findByRole('button', { name: 'Send KYC again' })).toBeInTheDocument()
  })

  it.each([
    ['a KYC request is already waiting', returned({ pending_requests: [{ id: 3, kind: 'business.kyc', title: 'New business: Adwoa Fabrics', created_at: '2026-10-08T10:00:00Z', due_at: '2026-10-09T10:00:00Z', stage: 'manager', waiting_for: 'Ama Boateng' }] }), SCOUT],
    ['KYC is already approved', business({ kyc_status: 'verified' }), SCOUT],
    ['the viewer is Operations, not its account manager', returned({ can_manage: false }), OPS],
  ])('does not offer it when %s', async (_why, b, auth) => {
    serve(b)
    renderPage({ auth })
    expect(await screen.findByRole('heading', { name: 'Adwoa Fabrics' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send KYC again' })).not.toBeInTheDocument()
  })

  it('does not offer it to a Super Admin who does not manage the business', async () => {
    serve(returned({ can_manage: false }))
    renderPage({ auth: BOSS })
    expect(await screen.findByRole('heading', { name: 'Adwoa Fabrics' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send KYC again' })).not.toBeInTheDocument()
  })

  it('does not offer it for a business that registered itself online', async () => {
    serve(returned({ registration_channel: 'self' }))
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Adwoa Fabrics' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send KYC again' })).not.toBeInTheDocument()
  })

  it('sends the retaken photos and a note in one multipart request and says who it went to', async () => {
    const gets = serve(returned())
    const seen = answerKyc({ approval_id: 9, approver_name: 'Ama Boateng' })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Send KYC again' }))
    const form = screen.getByRole('form', { name: 'Send KYC again' })
    fireEvent.change(within(form).getByLabelText('New signboard photo'), { target: { files: [new File(['sign'], 'daylight.jpg', { type: 'image/jpeg' })] } })
    fireEvent.change(within(form).getByLabelText('Note for the approver (optional)'), { target: { value: 'Retook the signboard in daylight' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Send the KYC request' }))
    expect(await screen.findByText('Sent to Ama Boateng')).toBeInTheDocument()
    expect(seen.calls).toBe(1)
    expect(seen.contentType).toMatch(/^multipart\/form-data/)
    const fields = Object.fromEntries(append.mock.calls.map(([key, value]) => [key, value]))
    expect(fields.signboard_photo).toBeInstanceOf(File)
    expect(fields.maker_note).toBe('Retook the signboard in daylight')
    expect(fields).not.toHaveProperty('ghana_card_front')
    await waitFor(() => expect(gets()).toBeGreaterThanOrEqual(2))
  })

  it('says the KYC queue when nobody in particular decides it, and cannot be sent twice', async () => {
    serve(returned())
    answerKyc({ approval_id: null, approver_name: null })
    renderPage({ auth: BOSS })
    fireEvent.click(await screen.findByRole('button', { name: 'Send KYC again' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send the KYC request' }))
    expect(await screen.findByText('Sent to the KYC queue')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send KYC again' })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Send KYC again' })).not.toBeInTheDocument()
    expect(screen.queryByText(/No KYC request is waiting/)).not.toBeInTheDocument()
  })

  it("shows the server's reason when it can't be sent", async () => {
    serve(returned())
    server.use(http.post(KYC_URL, () => HttpResponse.json({ detail: 'A KYC request for this business is already waiting for a decision.', code: 'already_pending' }, { status: 400 })))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Send KYC again' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send the KYC request' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A KYC request for this business is already waiting for a decision.')
  })
})
