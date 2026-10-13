import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import DeliveryZonesPanel from '../DeliveryZonesPanel.jsx'
import DocumentsPanel from '../DocumentsPanel.jsx'
import InviteRiderPanel from '../InviteRiderPanel.jsx'
import Riders from '../RidersPanel.jsx'
import ShiftsPanel from '../ShiftsPanel.jsx'
import VehiclesPanel from '../VehiclesPanel.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const auth = { user: { id: 3, full_name: 'Adwoa Sarpong', role: 'delivery_manager' }, hasPermission: () => true }
const zones = { results: [{ id: 1, name: 'Adum', boundary: null, area_km2: null, express_offered: false, active: true, riders: [{ id: 1, full_name: 'Kofi Appiah' }] }] }

const rider = (over = {}) => ({
  id: 1, staff_id: 4, full_name: 'Kofi Appiah', status: 'on_shift', status_label: 'Free', vehicle_type: 'motorbike', vehicle: { id: 1, plate: 'AS 4471-22' }, home_zone: { id: 1, name: 'Adum' },
  jobs_today: 3, delivered_today: 2, on_time_30d: { on_time: 0, of: 0 }, could_not_deliver_30d: 0, delivered_30d: 9, acceptance_30d: { accepted: 8, of: 10 }, cash_held: null,
  location: { last_fix_at: '2026-10-13T08:00:00Z', age_seconds: 200, stale: true }, papers: { missing: [], expiring: 0, expired: 0, waiting: 0 }, job_hold: false, suspended: false, suspension_reason: null, suspension_source: '', invited: false, ...over,
})

describe('Riders and drivers', () => {
  it('shows no invented on-time or cash figure and flags a low acceptance rate and a stale fix', async () => {
    server.use(
      http.get(`${API}/api/delivery/zones/`, () => HttpResponse.json(zones)),
      http.get(`${API}/api/delivery/riders/`, () => HttpResponse.json({ results: [rider({ acceptance_30d: { accepted: 5, of: 10 } })], counts: { on_shift: 1 }, total: 1, stale_after_seconds: 120 })),
    )
    wrap(<Riders detailId={null} onOpenDetail={() => {}} onNavigate={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Kofi Appiah' })).toBeInTheDocument()
    expect(screen.getByText('No data yet')).toBeInTheDocument() // on time: no job had a deliver-by time
    expect(screen.getByText('50%')).toHaveStyle({ fontWeight: '800' })
    expect(screen.getByText('Not applicable')).toBeInTheDocument() // cash
    expect(screen.getByText(/Location 3 min old · stale/)).toBeInTheDocument()
  })

  it('passes the filters to the server', async () => {
    const seen = []
    server.use(
      http.get(`${API}/api/delivery/zones/`, () => HttpResponse.json(zones)),
      http.get(`${API}/api/delivery/riders/`, ({ request }) => { seen.push(new URL(request.url).search); return HttpResponse.json({ results: [], counts: {}, total: 0 }) }),
    )
    wrap(<Riders detailId={null} onOpenDetail={() => {}} onNavigate={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Suspended' }))
    await waitFor(() => expect(seen.some((s) => s.includes('status=suspended'))).toBe(true))
    expect(await screen.findByText(/No rider matches/)).toBeInTheDocument()
  })

  const profile = (r) => ({
    rider: rider(r), staff: { id: 4, full_name: 'Kofi Appiah', phone: '+233245550556', manager: { id: 3, full_name: 'Adwoa Sarpong' }, activated_at: '2026-06-02T08:00:00Z', start_date: null },
    documents: [{ id: 9, kind: 'insurance', kind_label: 'Insurance', required: true, number_masked: '•••• 4421', expires_on: '2026-10-31', days_left: 18, status: 'approved', status_label: 'Approved' }], required: [],
    vehicle: { plate: 'AS 4471-22', vehicle_type_label: 'Motorbike', description: 'Honda CG 125', owner_label: 'Owned by the rider', papers: [{ label: 'Insurance', expires_on: '2026-10-31', days_left: 18 }] },
    recent_jobs: [{ id: 55, order_id: 8, status_label: 'Delivered', assigned_at: '2026-10-13T08:00:00Z', address: 'Ahodwo', flagged: true }], devices: [{ id: 1, device_label: 'Tecno', signed_in_at: '2026-10-02T07:00:00Z', last_seen_at: '2026-10-13T08:00:00Z' }], pay: null,
  })
  it('shows the profile with masked papers, and suspends with a reason', async () => {
    let body
    server.use(
      http.get(`${API}/api/delivery/zones/`, () => HttpResponse.json(zones)),
      http.get(`${API}/api/delivery/riders/1/`, () => HttpResponse.json(profile())),
      http.post(`${API}/api/accounts/staff/4/suspend/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}) }),
    )
    wrap(<Riders detailId="1" onOpenDetail={() => {}} onNavigate={() => {}} />)
    expect(await screen.findByText('•••• 4421')).toBeInTheDocument()
    expect(screen.getByText(/phone \+233 ••• 556/)).toBeInTheDocument()
    expect(screen.queryByText('+233245550556')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }))
    expect(screen.getByRole('button', { name: 'Confirm suspension' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Reason (the rider is told)'), { target: { value: 'Two no-shows' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm suspension' }))
    await waitFor(() => expect(body).toEqual({ reason: 'Two no-shows' }))
  })

  it('offers reinstate only for a papers suspension', async () => {
    let called = false
    server.use(
      http.get(`${API}/api/delivery/zones/`, () => HttpResponse.json(zones)),
      http.get(`${API}/api/delivery/riders/1/`, () => HttpResponse.json(profile({ suspended: true, suspension_reason: 'Insurance expired', suspension_source: 'documents', status: 'suspended', status_label: 'Suspended' }))),
      http.post(`${API}/api/delivery/riders/1/reinstate/`, () => { called = true; return HttpResponse.json({ id: 1, suspended: false }) }),
    )
    wrap(<Riders detailId="1" onOpenDetail={() => {}} onNavigate={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reinstate (papers are in order)' }))
    await waitFor(() => expect(called).toBe(true))
    expect(screen.getByRole('button', { name: 'Lift suspension' })).toBeInTheDocument()
  })
})

describe('Documents', () => {
  const docs = (results) => ({ bucket: 'waiting', results, counts: { waiting: results.length, expiring: 1, expired: 0, riders_missing_papers: 1 }, riders_missing_papers: [{ id: 2, full_name: 'Esi Owusu', missing: ['insurance'] }] })
  const doc = { id: 9, kind: 'insurance', kind_label: 'Insurance', required: true, number_masked: '•••• 4421', expires_on: '2026-12-01', days_left: 49, status: 'uploaded', status_label: 'Waiting for a check', reject_reason: '', rider: { id: 1, full_name: 'Kofi Appiah', suspended: false } }
  it('approves with the expiry typed from the scan, and sends back only with a reason', async () => {
    const bodies = []
    server.use(
      http.get(`${API}/api/delivery/documents/`, () => HttpResponse.json(docs([doc]))),
      http.post(`${API}/api/delivery/documents/9/review/`, async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({}) }),
    )
    wrap(<DocumentsPanel onNavigate={() => {}} />)
    expect(await screen.findByText('Esi Owusu', { exact: false })).toBeInTheDocument()
    expect(screen.getByText(/pending DVLA/, { exact: false })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Send back' }))
    const send = screen.getAllByRole('button', { name: 'Send back' }).at(-1)
    expect(send).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Why Insurance is sent back'), { target: { value: 'Blurred' } })
    fireEvent.click(send)
    await waitFor(() => expect(bodies).toEqual([{ decision: 'reject', reject_reason: 'Blurred' }]))
  })

  it('approves', async () => {
    const bodies = []
    server.use(http.get(`${API}/api/delivery/documents/`, () => HttpResponse.json(docs([doc]))), http.post(`${API}/api/delivery/documents/9/review/`, async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({}) }))
    wrap(<DocumentsPanel onNavigate={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(bodies).toEqual([{ decision: 'approve', expires_on: '2026-12-01' }]))
  })
})

describe('Vehicles', () => {
  it('lists papers with days left, assigns a vehicle and adds one', async () => {
    const assigned = []
    const added = []
    server.use(
      http.get(`${API}/api/delivery/vehicles/`, () => HttpResponse.json({ results: [{ id: 1, plate: 'AS 4471-22', vehicle_type: 'motorbike', vehicle_type_label: 'Motorbike', description: 'Honda', owner_label: 'Owned by the rider', status: 'active', rider: null, papers: [{ label: 'Insurance', expires_on: '2026-10-20', days_left: 7 }, { label: 'Roadworthy', expires_on: null, days_left: null }] }], counts: { motorbike: 1 }, total: 1 })),
      http.get(`${API}/api/delivery/riders/`, () => HttpResponse.json({ results: [rider()], counts: {}, total: 1 })),
      http.post(`${API}/api/delivery/vehicles/1/assign/`, async ({ request }) => { assigned.push(await request.json()); return HttpResponse.json({}) }),
      http.post(`${API}/api/delivery/vehicles/`, async ({ request }) => { added.push(await request.json()); return HttpResponse.json({}, { status: 201 }) }),
    )
    wrap(<VehiclesPanel />)
    expect(await screen.findByText(/Roadworthy: not recorded/)).toBeInTheDocument()
    await screen.findByRole('option', { name: 'Kofi Appiah' })
    fireEvent.change(screen.getByLabelText('Rider for AS 4471-22'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }))
    await waitFor(() => expect(assigned).toEqual([{ rider: 1 }]))
    fireEvent.click(screen.getByRole('button', { name: 'Add a vehicle' }))
    const form = await screen.findByRole('region', { name: 'Add a vehicle' })
    fireEvent.change(within(form).getByLabelText('Plate'), { target: { value: 'GT 12-26' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add vehicle' }))
    await waitFor(() => expect(added).toEqual([{ plate: 'GT 12-26', vehicle_type: 'motorbike', owner_kind: 'rider' }]))
  })
})

describe('Invite a rider', () => {
  it('invites with the Dispatch role under the manager and lists the pending invite', async () => {
    let body
    server.use(
      http.get(`${API}/api/delivery/invites/`, () => HttpResponse.json({ pending: [{ id: 7, full_name: 'Yaw Badu', email: 'yaw@example.com', state: 'sent', sent_at: '2026-10-12T08:00:00Z', expires_at: '2026-10-19T08:00:00Z', vehicle_type: 'car', home_zone: 'Adum', first_shift_date: null }], vehicle_types: [{ value: 'motorbike', label: 'Motorbike' }, { value: 'car', label: 'Car' }], zones: [{ id: 1, name: 'Adum' }], sms: 'not_connected' })),
      http.post(`${API}/api/accounts/staff/invite/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}, { status: 201 }) }),
    )
    wrap(<InviteRiderPanel auth={auth} />)
    expect(await screen.findByText('Yaw Badu')).toBeInTheDocument()
    expect(screen.getByText(/SMS is not connected/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Nii Armah' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nii@example.com' } })
    fireEvent.change(screen.getByLabelText('Home zone'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    await waitFor(() => expect(body).toEqual({ full_name: 'Nii Armah', email: 'nii@example.com', role: 'dispatch', vehicle_type: 'motorbike', manager: 3, home_zone: 1 }))
    expect(await screen.findByText('Invite sent to nii@example.com.')).toBeInTheDocument()
  })

  it('resends and cancels', async () => {
    const calls = []
    server.use(
      http.get(`${API}/api/delivery/invites/`, () => HttpResponse.json({ pending: [{ id: 7, full_name: 'Yaw Badu', email: 'yaw@example.com', state: 'expired', sent_at: '2026-10-01T08:00:00Z', expires_at: null, vehicle_type: 'car', home_zone: null, first_shift_date: null }], vehicle_types: [], zones: [], sms: 'not_connected' })),
      http.post(`${API}/api/accounts/staff/7/resend-invite/`, () => { calls.push('resend'); return HttpResponse.json({}) }),
      http.post(`${API}/api/accounts/staff/7/cancel-invite/`, () => { calls.push('cancel'); return HttpResponse.json({}) }),
    )
    wrap(<InviteRiderPanel auth={auth} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Resend invite to Yaw Badu' }))
    await waitFor(() => expect(calls).toEqual(['resend']))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invite to Yaw Badu' }))
    await waitFor(() => expect(calls).toEqual(['resend', 'cancel']))
  })
})

describe('Shifts', () => {
  const week = (over = {}) => ({
    week_start: '2026-10-12', results: [{ id: 1, rider: { id: 1, full_name: 'Kofi Appiah' }, zone: { id: 1, name: 'Adum' }, starts_at: '2026-10-13T08:00:00', ends_at: '2026-10-13T17:00:00', status: 'draft', status_label: 'Draft' }, { id: 2, rider: { id: 1, full_name: 'Kofi Appiah' }, zone: null, starts_at: '2026-10-14T08:00:00', ends_at: '2026-10-14T17:00:00', status: 'swap', status_label: 'Swap asked', swap_with: { id: 2, full_name: 'Esi Owusu' } }],
    demand: [{ date: '2026-10-13', enough_history: false, average_deliveries: null, shifts_needed: null, per_shift: 12 }, { date: '2026-10-14', enough_history: true, average_deliveries: 30, shifts_needed: 3, per_shift: 12 }],
    counts: { draft: 1, published: 0, open: 0, swap: 1 }, riders: [{ id: 1, full_name: 'Kofi Appiah' }], zones: [{ id: 1, name: 'Adum' }], ...over,
  })
  it('says there is not enough history instead of inventing demand, and publishes the week', async () => {
    let published
    server.use(http.get(`${API}/api/delivery/shifts/`, () => HttpResponse.json(week())), http.post(`${API}/api/delivery/shifts/publish/`, async ({ request }) => { published = await request.json(); return HttpResponse.json({ published: 1, riders_told: 1 }) }))
    wrap(<ShiftsPanel />)
    expect(await screen.findByText('Expected about 30 deliveries: 3 shifts (12 deliveries a shift)')).toBeInTheDocument()
    expect(screen.getAllByText('Not enough history to expect a demand').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(published).toEqual({ week: '2026-10-12' }))
    expect(await screen.findByText('Published 1 shifts; 1 riders told.')).toBeInTheDocument()
  })

  it('decides a swap', async () => {
    let decision
    server.use(http.get(`${API}/api/delivery/shifts/`, () => HttpResponse.json(week())), http.post(`${API}/api/delivery/shifts/2/swap-decision/`, async ({ request }) => { decision = await request.json(); return HttpResponse.json({}) }))
    wrap(<ShiftsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Approve swap' }))
    await waitFor(() => expect(decision).toEqual({ approve: true }))
  })
})

describe('Zones', () => {
  it('says a zone has no boundary and saves a typed one', async () => {
    let body
    server.use(http.get(`${API}/api/delivery/zones/`, () => HttpResponse.json(zones)), http.patch(`${API}/api/delivery/zones/1/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}) }))
    wrap(<DeliveryZonesPanel />)
    expect(await screen.findByText('No boundary drawn')).toBeInTheDocument()
    expect(screen.getByText(/There is no map-drawing tool/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit boundary' }))
    fireEvent.change(screen.getByLabelText(/Boundary/), { target: { value: '-1.62, 6.69\n-1.60, 6.69\n-1.61, 6.71' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save zone' }))
    await waitFor(() => expect(body).toEqual({ name: 'Adum', boundary: [[-1.62, 6.69], [-1.6, 6.69], [-1.61, 6.71]] }))
  })
})
