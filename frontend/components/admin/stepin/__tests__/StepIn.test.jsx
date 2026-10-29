import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiPost, setStoredAuth } from '../../../../apiClient.js'
import { clearViewAs } from '../../../../lib/viewAs.js'
import { server } from '../../../../mocks/server.js'
import AdminCommandCenter from '../../AdminCommandCenter.jsx'
import useViewOnlyControls, { changesData } from '../useViewOnlyControls.js'

const API = 'http://localhost:8000'
const SIMON = { id: 1, full_name: 'Simon Peter', role: 'super_admin' }
const ESI = { id: 7, full_name: 'Esi Nyarko', role: 'support', role_label: 'Support', team: 'support', manager: null }
const NANA = { id: 8, full_name: 'Nana Yaa Ofori', role: 'support', role_label: 'Support', team: 'support', manager: null }
const AMA = { id: 5, full_name: 'Ama Boateng', role: 'operations', role_label: 'Operations', team: 'operations', manager: null }
const ESI_ME = { account_type: 'staff', id: 7, full_name: 'Esi Nyarko', role: 'support', permissions: ['messaging.manage'], manager: null }

function superAdmin() {
  return { user: { token: 'token-of-simon', account_type: 'staff', ...SIMON, permissions: ['staff.view_as'] }, hasPermission: () => true }
}

function renderShell(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminCommandCenter auth={superAdmin()} onExit={vi.fn()} activeTab="step-in-support" onTabChange={vi.fn()} {...props} />
    </QueryClientProvider>,
  )
}

function serve() {
  const calls = { started: [], ended: 0, me: [] }
  server.use(
    http.get(`${API}/api/accounts/staff/view-as/`, () => HttpResponse.json({ current: null, people: [AMA, ESI, NANA], teams: {} })),
    http.post(`${API}/api/accounts/staff/view-as/`, async ({ request }) => {
      const { staff } = await request.json()
      calls.started.push(staff)
      const person = [AMA, ESI, NANA].find((p) => p.id === staff)
      return HttpResponse.json({ current: { staff: person, started_at: '2026-10-13T11:46:00Z' } }, { status: 201 })
    }),
    http.post(`${API}/api/accounts/staff/view-as/end/`, () => { calls.ended += 1; return HttpResponse.json({ current: null }) }),
    http.get(`${API}/api/accounts/me/`, ({ request }) => {
      calls.me.push({ viewAs: request.headers.get('X-View-As'), screen: request.headers.get('X-View-As-Screen'), url: request.url })
      const id = Number(request.headers.get('X-View-As'))
      if (id === NANA.id) return HttpResponse.json({ ...ESI_ME, id: 8, full_name: 'Nana Yaa Ofori' })
      return HttpResponse.json(id ? ESI_ME : { account_type: 'staff', ...SIMON, permissions: ['staff.view_as'] })
    }),
    http.get(`${API}/api/messaging/staff/`, () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })),
  )
  return calls
}

beforeEach(() => setStoredAuth({ token: 'token-of-simon', account_type: 'staff', id: 1, full_name: 'Simon Peter' }))
afterEach(() => { clearViewAs(); setStoredAuth(null) })

describe('Teams (step in)', () => {
  it("lists the team's people; Support is rebuilt now, so no not-rebuilt notice", async () => {
    serve()
    renderShell()
    expect(screen.getByRole('heading', { name: 'Step in: Support' })).toBeInTheDocument()
    expect(screen.queryByText(/has not been rebuilt/)).not.toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Support people' })
    expect(within(list).getByText('Esi Nyarko')).toBeInTheDocument()
    expect(within(list).queryByText('Ama Boateng')).not.toBeInTheDocument()
    expect(screen.queryByText(/being built/)).not.toBeInTheDocument() // no placeholder any more
  })

  it("opens the person's real shell read-only under a banner, then Exit returns to the Super Admin's", async () => {
    const calls = serve()
    renderShell()
    fireEvent.click(await screen.findByRole('button', { name: 'View as Esi Nyarko, read-only' }))
    expect(await screen.findByText(/Viewing as Support \(read-only\) · logged/)).toBeInTheDocument()
    expect(calls.started).toEqual([7])
    // Her own menu and panels, not the Super Admin's.
    expect(await screen.findByText('Canned replies')).toBeInTheDocument() // the rebuilt Support menu
    expect(screen.queryByText('Staff directory')).not.toBeInTheDocument()
    expect(screen.getByText(/you stay signed in as Simon Peter/)).toBeInTheDocument()
    expect(screen.queryByText(/has not been rebuilt/)).not.toBeInTheDocument()
    const throughView = calls.me.find((c) => c.url.includes('viewing=1'))
    expect(throughView).toMatchObject({ viewAs: '7', screen: 'overview' })

    fireEvent.click(screen.getByRole('button', { name: 'Exit' }))
    expect(await screen.findByRole('heading', { name: 'Step in: Support' })).toBeInTheDocument()
    expect(calls.ended).toBe(1)
    expect(screen.queryByText(/Viewing as Support/)).not.toBeInTheDocument()
  })

  it('switches person from the banner and keeps writes from leaving the browser', async () => {
    const calls = serve()
    let wrote = 0
    server.use(http.post(`${API}/api/notifications/read-all/`, () => { wrote += 1; return HttpResponse.json({}) }))
    renderShell()
    fireEvent.click(await screen.findByRole('button', { name: 'View as Esi Nyarko, read-only' }))
    await screen.findByText(/Viewing as Support/)
    const error = await apiPost('/api/notifications/read-all/', {}).catch((e) => e)
    expect(error.body.code).toBe('view_only')
    expect(wrote).toBe(0)
    expect(await screen.findByText(/switched off while you are viewing/)).toBeInTheDocument()

    const switcher = await screen.findByRole('group', { name: 'Switch person' })
    fireEvent.click(within(switcher).getByRole('button', { name: 'Nana Yaa Ofori' }))
    await waitFor(() => expect(calls.started).toEqual([7, 8]))
    expect(await screen.findByText(/You see Nana Yaa Ofori's workspace/)).toBeInTheDocument()
  })

  it('offers View as in the header: Myself and everyone who can be opened, by team', async () => {
    const calls = serve()
    renderShell({ activeTab: 'step-in-operations' })
    const select = await screen.findByRole('combobox', { name: 'View as' })
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Esi Nyarko · Support' })).toBeInTheDocument())
    expect(within(select).getByRole('option', { name: 'Myself' })).toBeInTheDocument()
    expect(within(select).getByRole('group', { name: 'Operations & scouts (read-only)' })).toBeInTheDocument()
    fireEvent.change(select, { target: { value: '7' } })
    expect(await screen.findByText(/Viewing as Support/)).toBeInTheDocument()
    expect(calls.started).toEqual([7])
    fireEvent.change(screen.getByRole('combobox', { name: 'View as' }), { target: { value: '' } })
    await waitFor(() => expect(calls.ended).toBe(1))
    await waitFor(() => expect(screen.queryByText(/Viewing as Support/)).not.toBeInTheDocument())
  })

  it('signing out from a view ends it first, so the sign-out goes as the Super Admin', async () => {
    const calls = serve()
    const onExit = vi.fn()
    renderShell({ onExit })
    fireEvent.click(await screen.findByRole('button', { name: 'View as Esi Nyarko, read-only' }))
    await screen.findByText(/Viewing as Support/)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1))
    expect(calls.ended).toBe(1)
  })

  it("opens an Operations lead's real Operations shell with its data-changing buttons off", async () => {
    const calls = serve()
    const OPS_ME = { account_type: 'staff', id: 5, full_name: 'Ama Boateng', role: 'operations', manager: null,
      permissions: ['portfolio.manage', 'targets.manage', 'staff.invite_team', 'kyc.approve', 'leave.record'] }
    server.use(
      http.get(`${API}/api/accounts/me/`, ({ request }) => {
        calls.me.push({ viewAs: request.headers.get('X-View-As') })
        return HttpResponse.json(request.headers.get('X-View-As') === '5' ? OPS_ME : { account_type: 'staff', ...SIMON })
      }),
      http.get(`${API}/api/operations/overview/`, ({ request }) => {
        calls.me.push({ overview: request.headers.get('X-View-As') })
        return HttpResponse.json({
          period: 'today', today: '2026-10-13', now: '2026-10-13T11:46:00', scout_count: 0, month_label: 'October',
          kpis: {
            registrations: { done: 0, target: 0, planned: 0 }, activations: { count: 0, registered: 0 }, approvals: { waiting: 0, oldest: null },
            checked_in: { count: 0, working: 0, on_leave: [], flagged: 0 }, at_risk: { count: 0, needs_attention: 0 },
            issues: { total: 0, fraud: 0, support: null, delivery: null },
          },
          scouts: [], totals: { registrations: { done: 0, target: 0 }, visits: { done: 0, target: 0 }, calls: { done: 0, target: 0 }, listings: { done: 0, target: 0 }, visits_flagged: 0 },
          waiting: [], issues: [], issue_total: 0,
        })
      }),
    )
    renderShell({ activeTab: 'step-in-operations' })
    expect(await screen.findByRole('heading', { name: 'Step in: Operations & scouts' })).toBeInTheDocument()
    expect(screen.queryByText(/has not been rebuilt/)).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'View as Ama Boateng, read-only' }))
    expect(await screen.findByText(/Viewing as Operations \(read-only\) · logged/)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Operations overview' })).toBeInTheDocument()
    expect(screen.getByText('Approvals inbox')).toBeInTheDocument() // her menu, in her words
    expect(calls.me).toContainEqual({ overview: '5' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Set targets' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Set targets' })).toHaveAttribute('title', expect.stringMatching(/Switched off/))
    expect(screen.getByRole('button', { name: 'All measures' })).toBeEnabled()
    expect(screen.queryByText(/these are the screens/)).not.toBeInTheDocument()
  })

  it('says why when the server refuses to open a view', async () => {
    serve()
    server.use(http.post(`${API}/api/accounts/staff/view-as/`, () => HttpResponse.json(
      { detail: 'Stepping in needs a session signed in with 2-step sign-in.', code: 'view_as_refused' }, { status: 403 },
    )))
    renderShell()
    fireEvent.click(await screen.findByRole('button', { name: 'View as Esi Nyarko, read-only' }))
    expect(await screen.findByText('Stepping in needs a session signed in with 2-step sign-in.')).toBeInTheDocument()
    expect(screen.queryByText(/Viewing as/)).not.toBeInTheDocument()
  })
})

function Controls({ enabled }) {
  const ref = useRef(null)
  useViewOnlyControls(ref, enabled)
  return (
    <div ref={ref}>
      {['Approve', 'Return with note', '➕ Add a holiday', 'Set targets', 'Invite a scout', 'Returned', 'Approvals inbox', 'Resolved', 'Open', 'Reports', 'Settings', 'Today'].map((label) => (
        <button key={label} type="button">{label}</button>
      ))}
    </div>
  )
}

describe('controls that change data inside a step-in', () => {
  it('are switched off; tabs, filters and Open stay usable', async () => {
    render(<Controls enabled />)
    for (const label of ['Approve', 'Return with note', '➕ Add a holiday', 'Set targets', 'Invite a scout']) {
      await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeDisabled())
    }
    for (const label of ['Returned', 'Approvals inbox', 'Resolved', 'Open', 'Reports', 'Settings', 'Today']) {
      expect(screen.getByRole('button', { name: label })).toBeEnabled()
    }
  })

  it('are left alone outside a step-in', () => {
    render(<Controls enabled={false} />)
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
  })

  it('match on whole verbs', () => {
    expect(changesData('Cancel invite')).toBe(true)
    expect(changesData('Cancel')).toBe(false)
    expect(changesData('Rejected')).toBe(false)
    expect(changesData('📤 Export CSV')).toBe(true)
    expect(changesData('Wake now')).toBe(true)
    expect(changesData('Note to the team')).toBe(true)
    expect(changesData('Notes')).toBe(false)
  })
})
