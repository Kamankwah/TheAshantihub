import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import StaffDirectoryPanel from '../StaffDirectoryPanel.jsx'
import { API, SA, page, param, renderPanel } from './saTestUtils.jsx'

const row = (id, name, role, extra = {}) => ({
  id, name, email: `${name.split(' ')[0].toLowerCase()}@example.com`, role, role_label: role, manager: { id: 1, name: 'Simon Peter' }, areas: [], reports: 0,
  status: 'active', status_note: '', invite_expires_at: null, on_leave_to: null, last_sign_in_at: null, two_step: 'off', two_step_required: false, ...extra,
})
const ROWS = [
  row(1, 'Simon Peter', 'super_admin', { manager: null, two_step: 'on', two_step_required: true, last_sign_in_at: '2026-10-07T08:00:00Z' }),
  row(2, 'Ama Boateng', 'operations', { reports: 2, two_step: 'on' }),
  row(3, 'Kwame Asante', 'scout', { areas: ['Asafo', 'Bantama'], manager: { id: 2, name: 'Ama Boateng' } }),
  row(4, 'Afua Kyeremeh', 'scout', { status: 'invited', two_step: null, invite_expires_at: '2026-10-12T14:10:00Z' }),
  row(5, 'Kwaku Ansah', 'dispatch', { status: 'suspended', status_note: 'Licence expired' }),
]
const COUNTS = {
  all: 38, active: 34, invited: 2, invite_expired: 0, suspended: 1, deactivated: 1,
  by_role: [{ role: 'operations', label: 'Operations', active: 2, invited: 0, invite_expired: 0, suspended: 0, deactivated: 0, total: 2 }, { role: 'scout', label: 'Scout', active: 15, invited: 1, invite_expired: 0, suspended: 0, deactivated: 1, total: 17 }],
  two_step: { on: 4, active: 34 }, managers: [{ id: 2, name: 'Ama Boateng', role: 'operations' }],
  worth_a_look: [{ kind: 'suspended', staff: 5, name: 'Kwaku Ansah', text: 'is suspended: Licence expired.' }],
}

function setup() {
  const seen = { urls: [], exports: [] }
  server.use(
    http.get(`${API}/api/people/staff/`, ({ request }) => { seen.urls.push(request.url); return HttpResponse.json(page(ROWS)) }),
    http.get(`${API}/api/people/staff/counts/`, () => HttpResponse.json(COUNTS)),
    http.get(`${API}/api/people/staff/export/`, ({ request }) => { seen.exports.push(request.url); return new HttpResponse('a,b', { headers: { 'Content-Type': 'text/csv' } }) }),
  )
  return seen
}

describe('StaffDirectoryPanel', () => {
  it('shows each person with role, manager, team, status, last sign-in and 2-step', async () => {
    setup()
    renderPanel(<StaffDirectoryPanel auth={SA} onOpenDetail={() => {}} />)
    const table = await screen.findByRole('table', { name: 'Staff' })
    const kwame = within(table).getByText('Kwame Asante').closest('tr')
    expect(within(kwame).getByText('Ama Boateng')).toBeInTheDocument()
    expect(within(kwame).getByText('Asafo & Bantama')).toBeInTheDocument()
    expect(within(kwame).getByText('Off')).toBeInTheDocument()
    expect(within(kwame).getByText('No sign-in in the last 90 days')).toBeInTheDocument()
    const simon = within(table).getByText('Simon Peter', { selector: 'div' }).closest('tr')
    expect(within(simon).getByText('On · required')).toBeInTheDocument()
    const ama = within(table).getByText('Ama Boateng', { selector: 'div' }).closest('tr')
    expect(within(ama).getByText('2 direct reports')).toBeInTheDocument()
  })

  it('does not invent a last sign-in for an invited person and shows the invite end', async () => {
    setup()
    renderPanel(<StaffDirectoryPanel auth={SA} onOpenDetail={() => {}} />)
    const table = await screen.findByRole('table', { name: 'Staff' })
    const afua = within(table).getByText('Afua Kyeremeh').closest('tr')
    expect(within(afua).getByText('Not yet')).toBeInTheDocument()
    expect(within(afua).getByText(/Invite ends/)).toBeInTheDocument()
  })

  it('reads the status chips, worth a look and the 2-step line from the whole staff', async () => {
    setup()
    renderPanel(<StaffDirectoryPanel auth={SA} onOpenDetail={() => {}} />)
    expect(await screen.findByRole('button', { name: 'All 38' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suspended 1' })).toBeInTheDocument()
    const look = screen.getByRole('region', { name: 'Worth a look' })
    expect(within(look).getByText(/is suspended: Licence expired/)).toBeInTheDocument()
    expect(screen.getByText('2-step sign-in is required for Super Admin and optional for everyone else; it is on for 4 of 34 active staff.')).toBeInTheDocument()
  })

  it('passes the filters, the search and the status chip to the server', async () => {
    const seen = setup()
    renderPanel(<StaffDirectoryPanel auth={SA} onOpenDetail={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Suspended 1' }))
    await waitFor(() => expect(seen.urls.some((u) => param(u, 'status') === 'suspended')).toBe(true))
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'scout' } })
    await waitFor(() => expect(seen.urls.some((u) => param(u, 'role') === 'scout')).toBe(true))
    fireEvent.change(screen.getByLabelText('2-step sign-in'), { target: { value: 'off' } })
    await waitFor(() => expect(seen.urls.some((u) => param(u, 'two_step') === 'off')).toBe(true))
    fireEvent.change(screen.getByLabelText('Name, email or phone'), { target: { value: 'kwa' } })
    await waitFor(() => expect(seen.urls.some((u) => param(u, 'q') === 'kwa')).toBe(true))
  })

  it('opens a profile and goes to Invites from "Invite staff"', async () => {
    setup()
    const opened = []
    const went = []
    renderPanel(<StaffDirectoryPanel auth={SA} onOpenDetail={(id) => opened.push(id)} onNavigate={(tab) => went.push(tab)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Kwame Asante' }))
    expect(opened).toEqual(['3'])
    fireEvent.click(screen.getByRole('button', { name: 'Invite staff' }))
    expect(went).toEqual(['invites'])
  })

  it('exports the filtered list (the password prompt is the shared one)', async () => {
    const seen = setup()
    renderPanel(<StaffDirectoryPanel auth={SA} onOpenDetail={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Export \(CSV\)/ }))
    await waitFor(() => expect(seen.exports.length).toBe(1))
  })
})
