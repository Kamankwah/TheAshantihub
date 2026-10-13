import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import StaffProfilePanel from '../StaffProfilePanel.jsx'
import { API, SA, page, renderPanel } from './saTestUtils.jsx'

const PROFILE = {
  id: 7, full_name: 'Kwame Asante', email: 'kwame@example.com', phone: '024 *** 4567', role: 'scout', role_label: 'Scout', status: 'active', suspension_reason: '',
  manager: { id: 2, name: 'Ama Boateng', role: 'operations', role_label: 'Operations' }, invited_by: 'Ama Boateng', areas: ['Asafo', 'Bantama'], reports_to_them: [],
  joined_at: '2026-06-02T09:00:00Z', start_date: null, invite_expires_at: null, invite_opened_at: null, last_sign_in_at: '2026-10-07T08:04:00Z',
  two_step: 'off', two_step_required: false, is_me: false,
  live: { signed_in: true, last_seen_at: '2026-10-07T11:45:00Z', on_leave_to: null, check_in: { place: "Nana's Chop Bar", at: '2026-10-07T10:52:00Z', outside_radius: false, distance_m: 20 } },
  performance: {
    id: 7, month: { done: 15, target: 81, due_by_today: 18, on_pace: false, leave_cut: 0 }, measures: { registrations: { done: 2, target: 3 }, calls: { done: 1, target: null } },
    portfolio: { healthy: 12, at_risk: 1 }, outside_7d: 1, fraud_case_open: false,
  },
  permissions: { role: ['calls.log'], extra: ['orders.manage_delivery'], revoked: [], effective: ['calls.log', 'orders.manage_delivery'] },
  sessions: [{ id: 31, device_label: 'Staff app on Android device', ip: '154.160.88.14', two_factor: false, created_at: '2026-10-07T08:04:00Z', last_seen_at: '2026-10-07T11:41:00Z', idle_ends_at: '2026-10-07T12:11:00Z', ends_at: '2026-10-07T20:04:00Z', is_current: false }],
  reports: [{ date: '2026-10-06', status: 'acknowledged', is_late: false }, { date: '2026-10-05', status: 'returned', is_late: true }],
  approvals: { made: [{ id: 1, title: 'Change phone for Adwoa Fabrics', kind: 'business.update', status: 'pending', created_at: '2026-10-07T09:58:00Z', decided_at: null, due_at: '2026-10-08T09:58:00Z' }], decided: [], waiting: [] },
  pay: { commission: { on_hold: { count: 3, amount: '750.00' }, payable: { count: 0, amount: '0.00' } }, pay_profile: null },
}

function setup(profile = PROFILE) {
  const seen = { posts: [] }
  server.use(
    http.get(`${API}/api/people/staff/7/`, () => HttpResponse.json(profile)),
    http.get(`${API}/api/activity/`, () => HttpResponse.json(page([{ id: 1, occurred_at: '2026-10-07T11:44:00Z', summary: 'Asafo Hair Studio KYC approved', verb: 'kyc-approve', target_label: 'Asafo Hair Studio' }]))),
    http.get(`${API}/api/commission/accruals/`, () => HttpResponse.json(page([{ id: 1, business: 'Asafo Hair Studio', amount: '250.00', status: 'on_hold', status_label: 'On hold' }]))),
    http.get(`${API}/api/people/teams/`, () => HttpResponse.json({ people: 3, teams: 1, tree: [], leads: [{ id: 2, name: 'Ama Boateng', role: 'operations', role_label: 'Operations' }, { id: 3, name: 'Kojo Badu', role: 'operations', role_label: 'Operations' }], history: [] })),
    http.post(`${API}/api/people/teams/reassign/`, async ({ request }) => { seen.posts.push(['reassign', await request.json()]); return HttpResponse.json({}) }),
    http.post(`${API}/api/people/staff/7/role/`, async ({ request }) => { seen.posts.push(['role', await request.json()]); return HttpResponse.json({}) }),
    http.post(`${API}/api/accounts/staff/7/suspend/`, async ({ request }) => { seen.posts.push(['suspend', await request.json()]); return HttpResponse.json({}) }),
    http.post(`${API}/api/accounts/staff/7/sign-out-everywhere/`, () => { seen.posts.push(['signout']); return HttpResponse.json({ ended: 1 }) }),
    http.post(`${API}/api/accounts/staff/sessions/31/end/`, () => { seen.posts.push(['end', 31]); return HttpResponse.json({}) }),
  )
  return seen
}
const show = () => renderPanel(<StaffProfilePanel id="7" auth={SA} onBack={() => {}} onNavigate={() => {}} />)

describe('StaffProfilePanel', () => {
  it('shows who they are, who they report to and what they are doing now', async () => {
    setup()
    show()
    expect(await screen.findByRole('heading', { name: 'Kwame Asante' })).toBeInTheDocument()
    expect(screen.getByText(/Reports to Ama Boateng \(Operations\)/)).toBeInTheDocument()
    expect(screen.getByText(/024 \*\*\* 4567/)).toBeInTheDocument()
    expect(screen.getByText(/Checked in at Nana's Chop Bar/)).toBeInTheDocument()
    expect(screen.getByText(/Signed in now/)).toBeInTheDocument()
  })

  it('has no View as unless the step-in is wired, and says so', async () => {
    setup()
    show()
    const button = await screen.findByRole('button', { name: /View as Kwame/ })
    expect(button).toBeDisabled()
    expect(screen.getByText(/It is not available yet/)).toBeInTheDocument()
  })

  it('offers View as when the step-in is wired', async () => {
    setup()
    const calls = []
    renderPanel(<StaffProfilePanel id="7" auth={SA} onBack={() => {}} onViewAs={(p) => calls.push(p.id)} />)
    fireEvent.click(await screen.findByRole('button', { name: /View as Kwame/ }))
    expect(calls).toEqual([7])
  })

  it('shows performance from the records and says so for a role without targets', async () => {
    setup()
    show()
    fireEvent.click(await screen.findByRole('tab', { name: 'Performance' }))
    expect(screen.getByText('15 of 81')).toBeInTheDocument()
    expect(screen.getByText(/18 expected by today · behind pace/)).toBeInTheDocument()
    expect(screen.getByText('Calls: 1 · no target set')).toBeInTheDocument()
  })

  it('says performance is measured for scouts when the person is not one', async () => {
    setup({ ...PROFILE, role: 'support', role_label: 'Support', performance: null })
    show()
    fireEvent.click(await screen.findByRole('tab', { name: 'Performance' }))
    expect(screen.getByText(/measured for scouts/)).toBeInTheDocument()
  })

  it('does not invent pay: commission from records and an honest note for the pay profile', async () => {
    setup()
    show()
    fireEvent.click(await screen.findByRole('tab', { name: 'Pay & commission' }))
    expect(await screen.findByText(/GH₵ 750\.00 · 3 lines · on hold/)).toBeInTheDocument()
    expect(screen.getByText(/arrive with the Accounting phase/)).toBeInTheDocument()
    expect(screen.queryByText(/MoMo/)).not.toBeInTheDocument()
    expect(screen.queryByText(/payslip for/i)).not.toBeInTheDocument()
  })

  it('lists activity, reports, approvals and the permission split', async () => {
    setup()
    show()
    fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }))
    expect(await screen.findByText(/Asafo Hair Studio KYC approved/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Reports' }))
    expect(screen.getByText(/6 Oct · Acknowledged/)).toBeInTheDocument()
    expect(screen.getByText(/5 Oct · Returned · late/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Approvals' }))
    expect(screen.getByText(/Change phone for Adwoa Fabrics · Waiting/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Access & devices' }))
    expect(screen.getByText(/Scout role \(1\) \+ 1 extra: orders\.manage_delivery/)).toBeInTheDocument()
    expect(screen.getByText('Not recorded')).toBeInTheDocument()
  })

  it('ends a session, signs out everywhere, suspends with a reason and changes manager and role', async () => {
    const seen = setup()
    show()
    fireEvent.click(await screen.findByRole('tab', { name: 'Access & devices' }))
    fireEvent.click(screen.getByRole('button', { name: 'End the session on Staff app on Android device' }))
    await waitFor(() => expect(seen.posts).toContainEqual(['end', 31]))

    fireEvent.click(screen.getByRole('button', { name: 'Sign out all devices' }))
    fireEvent.click(within(screen.getByRole('form', { name: 'Sign Kwame Asante out of every device' })).getByRole('button', { name: 'Sign out all devices' }))
    await waitFor(() => expect(seen.posts).toContainEqual(['signout']))

    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }))
    const form = screen.getByRole('form', { name: 'Suspend Kwame Asante' })
    expect(within(form).getByRole('button', { name: 'Suspend' })).toBeDisabled()
    fireEvent.change(within(form).getByLabelText(/Reason/), { target: { value: 'Under investigation' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Suspend' }))
    await waitFor(() => expect(seen.posts).toContainEqual(['suspend', { reason: 'Under investigation' }]))

    fireEvent.click(await screen.findByRole('button', { name: 'Change manager or role' }))
    const manager = await screen.findByRole('form', { name: 'Change manager' })
    await waitFor(() => expect(within(manager).getByRole('option', { name: /Kojo Badu/ })).toBeInTheDocument())
    expect(within(manager).queryByRole('option', { name: /Ama Boateng/ })).not.toBeInTheDocument() // already their manager
    fireEvent.change(within(manager).getByLabelText('New manager'), { target: { value: '3' } })
    fireEvent.change(within(manager).getByLabelText(/Reason for the manager change/), { target: { value: 'Rebalancing' } })
    fireEvent.click(within(manager).getByRole('button', { name: 'Change manager' }))
    await waitFor(() => expect(seen.posts).toContainEqual(['reassign', { staff: 7, manager: 3, reason: 'Rebalancing' }]))
  })

  it('hides every action on your own profile', async () => {
    setup({ ...PROFILE, is_me: true })
    show()
    await screen.findByRole('heading', { name: 'Kwame Asante' })
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change manager or role' })).not.toBeInTheDocument()
  })
})
