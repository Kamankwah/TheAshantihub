import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SaInvitesPanel from '../SaInvitesPanel.jsx'
import { API, renderPanel } from './saTestUtils.jsx'

const future = (days) => new Date(Date.now() + days * 86400000).toISOString()
const DATA = {
  link_days: 7,
  kpis: { open: 2, opened_unfinished: 1, expired: 1, open_by_role: { scout: 1, dispatch: 1 }, accepted_30_days: 3, median_days_to_accept: 1.0 },
  invites: [
    { id: 11, full_name: 'Afua Kyeremeh', email: 'afua@example.com', phone: null, role: 'scout', role_label: 'Scout', manager: { id: 3, name: 'Kojo Badu' }, invited_by: { id: 3, name: 'Kojo Badu', role: 'operations', role_label: 'Operations' }, sent_at: future(-2), expires_at: future(5), opened_at: null, state: 'not_opened', start_date: null, areas: [] },
    { id: 12, full_name: 'Kweku Asiedu', email: 'kweku@example.com', phone: null, role: 'dispatch', role_label: 'Dispatch', manager: null, invited_by: { id: 1, name: 'Simon Peter', role: 'super_admin', role_label: 'Super Admin' }, sent_at: future(-3), expires_at: future(4), opened_at: future(-1), state: 'opened', start_date: null, areas: [] },
    { id: 13, full_name: 'Abenaa Pokua', email: 'abenaa@example.com', phone: null, role: 'support', role_label: 'Support', manager: null, invited_by: null, sent_at: future(-12), expires_at: future(-4), opened_at: null, state: 'expired', start_date: null, areas: [] },
  ],
  recent: [{ state: 'accepted', name: 'Ama Kyei', role: 'dispatch', role_label: 'Dispatch', by: 'Adwoa Sarpong', at: future(-6), id: 9 }, { state: 'revoked', name: 'Yaw Agyei', role: 'accountant', role_label: 'Accounting', by: 'Simon Peter', at: future(-15), id: null }],
  roles: [{ name: 'scout', label: 'Scout' }, { name: 'dispatch', label: 'Dispatch' }, { name: 'accountant', label: 'Accounting' }, { name: 'cosigner', label: 'Co-signer' }, { name: 'super_admin', label: 'Super Admin' }],
  leads: [{ id: 3, name: 'Kojo Badu', role: 'operations', role_label: 'Operations' }],
  who_can_invite: [{ who: 'Super Admin', can: 'Any role' }, { who: 'Operations', can: 'Scout, Support' }],
}

function setup() {
  const seen = { posts: [] }
  server.use(
    http.get(`${API}/api/people/invites/`, () => HttpResponse.json(DATA)),
    http.get(`${API}/api/operations/invites/`, () => HttpResponse.json({ pending: [], joined: [], zones: [{ id: 5, name: 'Bantama', scouts: [] }], link_days: 7 })),
    http.post(`${API}/api/accounts/staff/invite/`, async ({ request }) => { seen.posts.push(['invite', await request.json()]); return HttpResponse.json({ id: 99 }, { status: 201 }) }),
    http.post(`${API}/api/accounts/staff/:id/resend-invite/`, ({ params }) => { seen.posts.push(['resend', params.id]); return HttpResponse.json({}) }),
    http.post(`${API}/api/accounts/staff/:id/cancel-invite/`, ({ params }) => { seen.posts.push(['cancel', params.id]); return new HttpResponse(null, { status: 204 }) }),
  )
  return seen
}

describe('SaInvitesPanel', () => {
  it('shows the KPIs, every role, who sent each invite and only the states that are tracked', async () => {
    setup()
    renderPanel(<SaInvitesPanel />)
    const table = await screen.findByRole('table', { name: 'Invites' })
    const afua = within(table).getByText('Afua Kyeremeh').closest('tr')
    expect(within(afua).getByText('Manager: Kojo Badu')).toBeInTheDocument()
    expect(within(afua).getByText('Sent · not opened')).toBeInTheDocument()
    const kweku = within(table).getByText('Kweku Asiedu').closest('tr')
    expect(within(kweku).getByText('Opened · password not set')).toBeInTheDocument()
    expect(within(table).getByText('Expired', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByText(/delivered/i, { selector: 'span' })).not.toBeInTheDocument()
    const strip = screen.getByRole('group', { name: 'Invites summary' })
    expect(within(strip).getByText('1 scout · 1 dispatch')).toBeInTheDocument()
    expect(within(strip).getByText(/Median 1 days/)).toBeInTheDocument()
  })

  it('filters by role', async () => {
    setup()
    renderPanel(<SaInvitesPanel />)
    const table = await screen.findByRole('table', { name: 'Invites' })
    fireEvent.change(within(screen.getByRole('region', { name: 'Open and expired invites' })).getByLabelText('Role'), { target: { value: 'dispatch' } })
    expect(within(table).queryByText('Afua Kyeremeh')).toBeNull()
    expect(within(table).getByText('Kweku Asiedu')).toBeInTheDocument()
  })

  it('resends, revokes after confirming, and sends a new link for an expired one', async () => {
    const seen = setup()
    renderPanel(<SaInvitesPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Resend invite to Afua Kyeremeh' }))
    await waitFor(() => expect(seen.posts).toContainEqual(['resend', '11']))
    fireEvent.click(screen.getByRole('button', { name: 'Send a new link to Abenaa Pokua' }))
    await waitFor(() => expect(seen.posts).toContainEqual(['resend', '13']))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke invite to Kweku Asiedu' }))
    expect(seen.posts.some((p) => p[0] === 'cancel')).toBe(false) // asks first
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(seen.posts).toContainEqual(['cancel', '12']))
  })

  it('lists accepted and revoked in the last 30 days', async () => {
    setup()
    renderPanel(<SaInvitesPanel />)
    const section = await screen.findByRole('region', { name: 'Accepted or revoked, last 30 days' })
    expect(within(section).getByText(/Ama Kyei · Dispatch · invited by Adwoa Sarpong/)).toBeInTheDocument()
    expect(within(section).getByText(/Yaw Agyei · Accounting · removed by Simon Peter/)).toBeInTheDocument()
  })

  it('invites any role, including the co-signer, with a manager', async () => {
    const seen = setup()
    renderPanel(<SaInvitesPanel />)
    const form = await screen.findByRole('form', { name: 'Invite someone' })
    expect(within(form).getByRole('option', { name: 'Co-signer' })).toBeInTheDocument()
    expect(within(form).getByRole('button', { name: 'Send invite' })).toBeDisabled()
    fireEvent.change(within(form).getByLabelText('Full name'), { target: { value: 'Kofi Cosign' } })
    fireEvent.change(within(form).getByLabelText('Email'), { target: { value: 'kofi@example.com' } })
    fireEvent.change(within(form).getByLabelText('Role'), { target: { value: 'cosigner' } })
    fireEvent.change(within(form).getByLabelText('Manager'), { target: { value: '3' } })
    expect(within(form).getByText(/decides only the requests above the co-sign limit/)).toBeInTheDocument()
    fireEvent.click(within(form).getByRole('button', { name: 'Send invite' }))
    await waitFor(() => expect(seen.posts[0]).toEqual(['invite', { full_name: 'Kofi Cosign', email: 'kofi@example.com', role: 'cosigner', manager: 3 }]))
  })

  it('offers areas for a scout and sends them', async () => {
    const seen = setup()
    renderPanel(<SaInvitesPanel />)
    const form = await screen.findByRole('form', { name: 'Invite someone' })
    fireEvent.change(within(form).getByLabelText('Full name'), { target: { value: 'New Scout' } })
    fireEvent.change(within(form).getByLabelText('Email'), { target: { value: 'ns@example.com' } })
    fireEvent.change(within(form).getByLabelText('Role'), { target: { value: 'scout' } })
    fireEvent.click(await within(form).findByLabelText('Bantama'))
    fireEvent.click(within(form).getByRole('button', { name: 'Send invite' }))
    await waitFor(() => expect(seen.posts[0][1].areas).toEqual([5]))
  })
})
