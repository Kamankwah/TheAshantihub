import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SaBusinessDetail from '../SaBusinessDetail.jsx'
import { API, SA, page, renderPanel } from './saTestUtils.jsx'

const BUSINESS = {
  id: 12, business_name: 'Akosua Ntoma Kente', owner_name: 'Akosua Ntoma', login_phone: '024 *** 509', zone: { id: 3, name: 'Bonwire' },
  kyc_status: 'verified', is_suspended: false, suspension_reason: '', registration_channel: 'scout', needs_claim: false,
  account_manager: { id: 9, full_name: 'Efua Mensah' }, registered_by: { id: 9, full_name: 'Efua Mensah' },
  health: { rating: 'healthy', reasons: [] }, subscription: { state: 'active', plan_name: 'Premium', monthly_price: '150.00', current_period_end: '2026-11-02T00:00:00Z' },
  listings_live: 2, listings_total: 3, listings_waiting: 1, last_order_at: '2026-10-07T10:00:00Z', open_fraud_flags: 0,
  business_kind: 'product', business_category: { id: 1, name: 'Kente & crafts' }, gps_address: 'AK-039-7781', email: '', created_at: '2026-06-12T09:00:00Z',
  listings: [{ id: 1, name: 'Handwoven kente stole', status: 'published', price_amount: '450.00', photos_count: 2 }, { id: 2, name: 'Kente graduation stole', status: 'pending_review', price_amount: '280.00', photos_count: 1 }],
  pending_requests: [], recent_calls: [{ id: 5, direction: 'out', outcome: 'connected', purpose: 'onboarding', started_at: '2026-10-03T10:00:00Z', staff_name: 'Efua Mensah' }],
  recent_visits: [], assignments: [{ scout_name: 'Efua Mensah', assigned_by_name: 'Simon Peter', reason: 'Registered it', started_at: '2026-06-12T09:00:00Z', ended_at: null }], open_flags: [], can_manage: false,
}
const OVERSIGHT = {
  payments_simulated: true, sales_month: { amount: '450.00', orders: 1 }, rating: { average: null, count: 0 }, open_disputes: 0, orders_total: 1,
  orders: [{ id: 24, customer: 'Abena Mensah', amount: '450.00', status: 'paid', delivery_status: 'shipped', delivery_method: 'door_to_door', rider: 'Kofi Appiah', placed_at: '2026-10-07T10:00:00Z' }],
  disputes: [{ id: 9, order: 24, reason: 'Quality Issue', status: 'resolved', customer: 'Akua Boakye', created_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-22T10:00:00Z', resolved_by: 'Adwoa Sarpong', refund_amount: '120.00' }],
  conversations: [{ id: 3, subject: 'Plan question', status: 'open', updated_at: '2026-10-01T10:00:00Z' }],
  payments: [{ id: 1, purpose: 'Premium subscription', amount: '150.00', status: 'success', at: '2026-10-02T10:00:00Z', reference: 'SUB-1' }], open_fraud_flags: 0,
}

function setup(over = {}) {
  const calls = { fraud: [], suspend: [] }
  server.use(
    http.get(`${API}/api/portfolio/businesses/12/`, () => HttpResponse.json({ ...BUSINESS, ...over })),
    http.get(`${API}/api/portfolio/businesses/12/oversight/`, () => HttpResponse.json(OVERSIGHT)),
    http.get(`${API}/api/activity/`, () => HttpResponse.json(page([{ id: 1, occurred_at: '2026-10-05T10:00:00Z', actor_label: 'Simon Peter', verb: 'business.reassigned', summary: 'Akosua Ntoma Kente → Efua Mensah' }]))),
    http.post(`${API}/api/fraud/flags/`, async ({ request }) => { calls.fraud.push(await request.json()); return HttpResponse.json({ id: 1 }, { status: 201 }) }),
    http.post(`${API}/api/accounts/business-owners/12/suspend/`, async ({ request }) => { calls.suspend.push(await request.json()); return HttpResponse.json({ id: 12 }) }),
  )
  return calls
}
const mount = () => renderPanel(<SaBusinessDetail businessId={12} auth={SA} onBack={() => {}} />)

describe('SaBusinessDetail', () => {
  it('shows the structured weekly hours, or Hours not set with the old text labelled', async () => {
    setup({ hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, closed: d === 6, opens: d === 6 ? null : '08:00', closes: d === 6 ? null : '18:00' })) })
    mount()
    expect(await screen.findByText('Mon-Sat 08:00-18:00, Sun closed')).toBeInTheDocument()
  })

  it('says Hours not set when the business has none', async () => {
    setup({ hours: [], opening_hours: 'Mon-Sat 8-6' })
    mount()
    expect(await screen.findByText('Hours not set (old text: Mon-Sat 8-6)')).toBeInTheDocument()
  })

  it('shows the header, the real figures and no settlement or held-money tile', async () => {
    setup()
    mount()
    expect(await screen.findByRole('heading', { name: 'Akosua Ntoma Kente' })).toBeInTheDocument()
    expect(screen.getByText(/Account manager/)).toHaveTextContent('Efua Mensah (Scout), who also registered it')
    const strip = await screen.findByRole('group', { name: 'Business summary' })
    await waitFor(() => expect(within(strip).getByText('GH₵ 450.00')).toBeInTheDocument())
    expect(within(strip).getByText('1 order · payments simulated')).toBeInTheDocument()
    expect(within(strip).getByText('No ratings yet')).toBeInTheDocument() // never a 0.0
    expect(screen.queryByText(/Next settlement/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Held for this business/)).not.toBeInTheDocument()
    expect(screen.getByText(/Held money and settlements are not recorded yet/)).toBeInTheDocument()
  })

  it('has the nine sections as tabs, with counts', async () => {
    setup()
    mount()
    const tabs = await screen.findByRole('tablist', { name: 'Business sections' })
    expect(within(tabs).getAllByRole('tab')).toHaveLength(9)
    await waitFor(() => expect(within(tabs).getByRole('tab', { name: 'Orders (1)' })).toBeInTheDocument())
    expect(within(tabs).getByRole('tab', { name: 'Disputes (1)' })).toBeInTheDocument()
    expect(within(tabs).getByRole('tab', { name: 'Calls (1)' })).toBeInTheDocument()
    expect(within(tabs).getByRole('tab', { name: 'Listings (2)' })).toBeInTheDocument()
  })

  it('shows orders, disputes with who decided, payments, calls and activity', async () => {
    setup()
    mount()
    const tabs = await screen.findByRole('tablist', { name: 'Business sections' })
    fireEvent.click(await within(tabs).findByRole('tab', { name: 'Orders (1)' }))
    const orders = await screen.findByRole('table', { name: 'Orders' })
    expect(within(orders).getByText('Abena Mensah')).toBeInTheDocument()
    expect(within(orders).getByText('Shipped · Kofi Appiah')).toBeInTheDocument()
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Disputes (1)' }))
    expect(await screen.findByText(/decided by Adwoa Sarpong/)).toHaveTextContent('refunded GH₵ 120.00')
    expect(screen.getByText(/Plan question/)).toBeInTheDocument()
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Subscription' }))
    expect(await screen.findByText(/Premium subscription · simulated/)).toBeInTheDocument()
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Activity' }))
    expect(await screen.findByText(/Akosua Ntoma Kente → Efua Mensah/)).toBeInTheDocument()
  })

  it('flags possible fraud with the business attached', async () => {
    const calls = setup()
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Flag possible fraud' }))
    const form = screen.getByRole('form', { name: 'Flag possible fraud' })
    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'Photos copied from another shop' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Raise case' }))
    await waitFor(() => expect(calls.fraud).toEqual([{ kind: 'other', title: 'Photos copied from another shop', detail: '', business_owner: 12 }]))
  })

  it('suspends with a reason', async () => {
    const calls = setup()
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Suspend' }))
    const form = screen.getByRole('form', { name: 'Suspend Akosua Ntoma Kente' })
    fireEvent.change(within(form).getByLabelText(/Reason/), { target: { value: 'Duplicate business' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Suspend' }))
    await waitFor(() => expect(calls.suspend).toEqual([{ reason: 'Duplicate business' }]))
  })

  it('offers to lift a suspension and shows why it is suspended', async () => {
    setup({ is_suspended: true, suspension_reason: 'Duplicate business' })
    mount()
    expect(await screen.findByText(/Suspended: Duplicate business/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lift suspension' })).toBeInTheDocument()
  })

  it('changes the account manager through the reassign form', async () => {
    setup()
    server.use(http.get(`${API}/api/accounts/scouts/`, () => HttpResponse.json([{ id: 10, full_name: 'Kwame Asante', role: 'scout', status: 'active' }])))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Change account manager' }))
    expect(await screen.findByLabelText('Reassign to')).toBeInTheDocument()
  })
})
