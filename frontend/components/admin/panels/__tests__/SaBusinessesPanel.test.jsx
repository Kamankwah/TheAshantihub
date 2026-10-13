import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SaBusinessesPanel from '../SaBusinessesPanel.jsx'
import { API, SA, page, param, renderPanel } from './saTestUtils.jsx'

const COUNTS = {
  total: 5, live: 3, activated_this_month: 1, kyc_waiting: 1, overdue: 1, paused: 0, at_risk: 1, fraud_open: 1,
  fraud_open_names: ['Suame Auto Parts'], suspended: 1, pause_enabled: false,
}
const row = (over = {}) => ({
  id: 12, business_name: 'Akosua Ntoma Kente', owner_name: 'Akosua Ntoma', login_phone: '024 *** 509', zone: { id: 3, name: 'Bonwire' },
  kyc_status: 'verified', is_suspended: false, suspension_reason: '', registration_channel: 'scout', needs_claim: false,
  account_manager: { id: 9, full_name: 'Efua Mensah' }, health: { rating: 'healthy', reasons: [] },
  subscription: { state: 'active', plan_name: 'Premium', current_period_end: '2026-11-02T00:00:00Z', pause_enabled: false },
  listings_live: 12, listings_total: 12, listings_waiting: 0, last_order_at: '2026-10-07T10:00:00Z', last_contact: null, open_fraud_flags: 0,
  ...over,
})
const ROWS = [
  row(),
  row({ id: 13, business_name: 'Suame Auto Parts', health: { rating: 'at_risk', reasons: ['Confirmed fraud case'] }, open_fraud_flags: 1, account_manager: null, registration_channel: 'self' }),
  row({ id: 14, business_name: 'Ejisu Fresh Juice', is_suspended: true, suspension_reason: 'Duplicate of another business' }),
]

function setup({ rows = ROWS, counts = COUNTS } = {}) {
  const urls = []
  const posts = []
  server.use(
    http.get(`${API}/api/portfolio/businesses/`, ({ request }) => { urls.push(request.url); return HttpResponse.json(page(rows, { summary: {} })) }),
    http.get(`${API}/api/portfolio/businesses/counts/`, () => HttpResponse.json(counts)),
    http.get(`${API}/api/accounts/scouts/`, () => HttpResponse.json([{ id: 9, full_name: 'Efua Mensah', role: 'scout', status: 'active' }])),
    http.get(`${API}/api/listings/zones/`, () => HttpResponse.json([{ id: 3, name: 'Bonwire' }])),
    http.post(`${API}/api/accounts/business-owners/:id/suspend/`, async ({ request, params }) => { posts.push({ id: params.id, ...(await request.json()) }); return HttpResponse.json({ id: 13, is_suspended: true }) }),
    http.post(`${API}/api/accounts/business-owners/:id/unsuspend/`, ({ params }) => { posts.push({ id: params.id, lifted: true }); return HttpResponse.json({ id: 14, is_suspended: false }) }),
  )
  return { urls, posts }
}

describe('SaBusinessesPanel', () => {
  it('shows the real counts, and no Paused tile while the pause is off', async () => {
    setup()
    renderPanel(<SaBusinessesPanel auth={SA} detailId={null} onOpenDetail={() => {}} />)
    const strip = await screen.findByRole('group', { name: 'Businesses summary' })
    await waitFor(() => expect(within(strip).getByText('Live on AshantiHub')).toBeInTheDocument())
    expect(within(strip).getByText('Suame Auto Parts')).toBeInTheDocument()
    expect(within(strip).queryByText('Paused')).not.toBeInTheDocument()
    expect(within(strip).getByText('Suspended')).toBeInTheDocument()
  })

  it('lists businesses with kyc, subscription, manager, health and flags', async () => {
    setup()
    renderPanel(<SaBusinessesPanel auth={SA} detailId={null} onOpenDetail={() => {}} />)
    const table = await screen.findByRole('table', { name: 'Businesses' })
    const akosua = within(table).getByText('Akosua Ntoma Kente').closest('tr')
    expect(within(akosua).getByText('Verified business')).toBeInTheDocument()
    expect(within(akosua).getByText('Efua Mensah')).toBeInTheDocument()
    const suame = within(table).getByText('Suame Auto Parts').closest('tr')
    expect(within(suame).getByText('🚩 Fraud case open')).toBeInTheDocument()
    expect(within(suame).getByText('None · self-registered')).toBeInTheDocument()
    const ejisu = within(table).getByText('Ejisu Fresh Juice').closest('tr')
    expect(within(ejisu).getByText('Suspended')).toBeInTheDocument()
    expect(within(ejisu).getByText('Duplicate of another business')).toBeInTheDocument()
  })

  it('sends the filters to the server', async () => {
    const { urls } = setup()
    renderPanel(<SaBusinessesPanel auth={SA} detailId={null} onOpenDetail={() => {}} />)
    fireEvent.change(await screen.findByLabelText('KYC'), { target: { value: 'suspended' } })
    await waitFor(() => expect(urls.some((u) => param(u, 'kyc') === 'suspended' && param(u, 'scope') === 'all')).toBe(true))
    fireEvent.change(screen.getByLabelText('Flags'), { target: { value: 'fraud' } })
    await waitFor(() => expect(urls.some((u) => param(u, 'flag') === 'fraud')).toBe(true))
    fireEvent.change(screen.getByLabelText('Account manager'), { target: { value: 'none' } })
    await waitFor(() => expect(urls.some((u) => param(u, 'unassigned') === '1')).toBe(true))
  })

  it('suspends only with a reason, and sends it', async () => {
    const { posts } = setup()
    renderPanel(<SaBusinessesPanel auth={SA} detailId={null} onOpenDetail={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Suspend Suame Auto Parts' }))
    const form = screen.getByRole('form', { name: 'Suspend Suame Auto Parts' })
    expect(within(form).getByText(/asks for your password and is recorded/)).toBeInTheDocument()
    const submit = within(form).getByRole('button', { name: 'Suspend' })
    expect(submit).toBeDisabled()
    fireEvent.change(within(form).getByLabelText(/Reason/), { target: { value: 'Fake business' } })
    fireEvent.click(submit)
    await waitFor(() => expect(posts).toEqual([{ id: '13', reason: 'Fake business' }]))
    expect(await screen.findByText('Suspended Suame Auto Parts.')).toBeInTheDocument()
  })

  it('lifts a suspension without asking for a reason', async () => {
    const { posts } = setup()
    renderPanel(<SaBusinessesPanel auth={SA} detailId={null} onOpenDetail={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Lift suspension of Ejisu Fresh Juice' }))
    fireEvent.click(within(screen.getByRole('form', { name: 'Lift the suspension of Ejisu Fresh Juice' })).getByRole('button', { name: 'Lift suspension' }))
    await waitFor(() => expect(posts).toEqual([{ id: '14', lifted: true }]))
  })

  it('opens a business', async () => {
    setup()
    const onOpenDetail = vi.fn()
    renderPanel(<SaBusinessesPanel auth={SA} detailId={null} onOpenDetail={onOpenDetail} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Akosua Ntoma Kente' }))
    expect(onOpenDetail).toHaveBeenCalledWith(12)
  })

  it('explains health from the rules, without the paused rule while the pause is off', async () => {
    setup()
    renderPanel(<SaBusinessesPanel auth={SA} detailId={null} onOpenDetail={() => {}} />)
    const rules = await screen.findByRole('region', { name: 'How health is worked out' })
    expect(within(rules).getByText(/no order in 60 days/)).toBeInTheDocument()
    expect(within(rules).queryByText(/Subscription paused/)).not.toBeInTheDocument()
  })

  it('says so when nothing matches', async () => {
    setup({ rows: [] })
    renderPanel(<SaBusinessesPanel auth={SA} detailId={null} onOpenDetail={() => {}} />)
    expect(await screen.findByText('No business matches these filters.')).toBeInTheDocument()
  })
})
