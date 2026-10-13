import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SaTeamsPanel from '../SaTeamsPanel.jsx'
import { API, renderPanel } from './saTestUtils.jsx'

const node = (id, name, role, role_label, children = [], extra = {}) => ({ id, name, role, role_label, status: 'active', areas: [], can_lead: children.length > 0, children, ...extra })
const CHART = {
  people: 5, teams: 2,
  tree: [node(1, 'Simon Peter', 'super_admin', 'Super Admin', [
    node(2, 'Ama Boateng', 'operations', 'Operations', [node(4, 'Kwame Asante', 'scout', 'Scout', [], { areas: ['Asafo'] }), node(5, 'Kobby Asare', 'support', 'Support')]),
    node(3, 'Kojo Badu', 'operations', 'Operations'),
  ])],
  leads: [{ id: 1, name: 'Simon Peter', role: 'super_admin', role_label: 'Super Admin' }, { id: 2, name: 'Ama Boateng', role: 'operations', role_label: 'Operations' }, { id: 3, name: 'Kojo Badu', role: 'operations', role_label: 'Operations' }],
  history: [{ id: 1, at: '2026-10-01T10:00:00Z', verb: 'staff.manager_changed', summary: 'Kwesi Ampofo now reports to Ama Boateng (was Kojo Badu)', by: 'Simon Peter' }],
}

function setup() {
  const seen = { posts: [] }
  server.use(
    http.get(`${API}/api/people/teams/`, () => HttpResponse.json(CHART)),
    http.post(`${API}/api/people/teams/reassign/`, async ({ request }) => { seen.posts.push(await request.json()); return HttpResponse.json({}) }),
  )
  return seen
}

describe('SaTeamsPanel', () => {
  it('draws the tree from the top down with counts, the lock note and the history', async () => {
    setup()
    renderPanel(<SaTeamsPanel onOpenStaff={() => {}} />)
    expect(await screen.findByText('5 people in 2 teams.')).toBeInTheDocument()
    const ama = screen.getByRole('article', { name: "Ama Boateng's team" })
    expect(within(ama).getByText('1 scout · 1 support')).toBeInTheDocument()
    expect(within(ama).getByText(/Asafo/)).toBeInTheDocument()
    expect(within(ama).getByText("Can't be deactivated while people report to them.")).toBeInTheDocument()
    const kojo = screen.getByRole('article', { name: "Kojo Badu's team" })
    expect(within(kojo).getByText('No direct reports')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Recent changes' })).getByText(/Kwesi Ampofo now reports to Ama Boateng/)).toBeInTheDocument()
  })

  it('opens a person', async () => {
    setup()
    const opened = []
    renderPanel(<SaTeamsPanel onOpenStaff={(id) => opened.push(id)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Kwame Asante' }))
    expect(opened).toEqual(['4'])
  })

  it('reassigns with a reason, explaining what changes first', async () => {
    const seen = setup()
    renderPanel(<SaTeamsPanel onOpenStaff={() => {}} />)
    const form = await screen.findByRole('form', { name: 'Reassign a manager' })
    const submit = within(form).getByRole('button', { name: 'Reassign' })
    expect(submit).toBeDisabled()
    fireEvent.change(within(form).getByLabelText('Person'), { target: { value: '5' } })
    expect(within(form).getByText('Reports to Ama Boateng now.')).toBeInTheDocument()
    expect(within(within(form).getByLabelText('New manager')).queryByRole('option', { name: /Ama Boateng/ })).toBeNull() // current manager is not offered
    fireEvent.change(within(form).getByLabelText('New manager'), { target: { value: '3' } })
    fireEvent.change(within(form).getByLabelText('Reason'), { target: { value: 'All support under one lead.' } })
    expect(within(form).getByText(/Kojo Badu reviews Kobby Asare's day reports/)).toBeInTheDocument()
    expect(within(form).getByText(/Requests already waiting stay with Ama Boateng/)).toBeInTheDocument()
    fireEvent.click(submit)
    await waitFor(() => expect(seen.posts).toEqual([{ staff: 5, manager: 3, reason: 'All support under one lead.' }]))
    expect(await screen.findByText('Kobby Asare now reports to Kojo Badu.')).toBeInTheDocument()
  })

  it('shows the server reason when a reassignment is refused', async () => {
    setup()
    server.use(http.post(`${API}/api/people/teams/reassign/`, () => HttpResponse.json({ detail: 'That would make someone their own manager.' }, { status: 400 })))
    renderPanel(<SaTeamsPanel onOpenStaff={() => {}} />)
    const form = await screen.findByRole('form', { name: 'Reassign a manager' })
    fireEvent.change(within(form).getByLabelText('Person'), { target: { value: '5' } })
    fireEvent.change(within(form).getByLabelText('New manager'), { target: { value: '3' } })
    fireEvent.change(within(form).getByLabelText('Reason'), { target: { value: 'x' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Reassign' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That would make someone their own manager.')
  })
})
