import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import InvitePanel from '../InvitePanel.jsx'

const API = 'http://localhost:8000'
const ZONES = [{ id: 1, name: 'Kronum', scouts: [] }, { id: 2, name: 'Tafo', scouts: ['Abena'] }, { id: 3, name: 'Adum', scouts: ['Efua', 'Kwame'] }]
const invite = (id, name, state, over = {}) => ({ id, full_name: name, email: `${id}@example.com`, role: 'scout', sent_at: '2026-10-02T09:00:00Z', expires_at: '2026-10-09T09:00:00Z', state, start_date: null, areas: [], ...over })
const overview = (over = {}) => ({ pending: [], joined: [], zones: ZONES, link_days: 7, ...over })

function serve({ data = overview(), roles = ['scout', 'support'], seen = {} } = {}) {
  server.use(
    http.get(`${API}/api/accounts/staff/invitable-roles/`, () => HttpResponse.json(roles)),
    http.get(`${API}/api/operations/invites/`, () => HttpResponse.json(data)),
    http.get(`${API}/api/accounts/staff/team/`, () => HttpResponse.json([])),
    http.post(`${API}/api/accounts/staff/invite/`, async ({ request }) => { seen.invite = await request.json(); return HttpResponse.json({ id: 9 }, { status: 201 }) }),
    http.post(`${API}/api/accounts/staff/:id/resend-invite/`, ({ params }) => { seen.resent = params.id; return HttpResponse.json({ status: 'invite resent' }) }),
    http.post(`${API}/api/accounts/staff/:id/cancel-invite/`, ({ params }) => { seen.cancelled = params.id; return new HttpResponse(null, { status: 204 }) }),
  )
}
function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><InvitePanel auth={{ user: { id: 3, full_name: 'Ama Boateng' }, hasPermission: () => true }} /></QueryClientProvider>)
}

describe('InvitePanel', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 7, 11, 46)) })
  afterEach(() => vi.useRealTimers())

  it('offers Scout and Support with their descriptions and the Super Admin limit note', async () => {
    serve()
    renderPanel()
    expect(await screen.findByRole('radio', { name: /Scout Registers and manages businesses in the field/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Support Runs the help desk and call log/ })).toBeInTheDocument()
    expect(screen.getByText('You can invite Scouts and Supports only. Other roles are invited by Super Admin.')).toBeInTheDocument()
    expect(screen.getByText(/The link lasts 7 days. Sent by email · SMS: not connected./)).toBeInTheDocument()
    expect(screen.getByText(/a team invite makes you their manager/)).toBeInTheDocument()
    expect(screen.getByText('Used for the self-dealing check on businesses they register')).toBeInTheDocument()
  })

  it('sends a scout invite with start date, phone and chosen areas, naming the lead as manager', async () => {
    const seen = {}
    serve({ seen })
    renderPanel()
    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Akwasi Bonsu' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'akwasi@example.com' } })
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: '0241234567' } })
    fireEvent.change(screen.getByLabelText('Starts on'), { target: { value: '2026-10-13' } })
    expect(screen.getByLabelText(/Kronum/)).toBeInTheDocument()
    expect(screen.getByText('· no scout yet')).toBeInTheDocument()
    expect(screen.getByText('· Efua, Kwame')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/Kronum/))
    fireEvent.click(screen.getByLabelText(/Tafo/))
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    await waitFor(() => expect(seen.invite).toEqual({ full_name: 'Akwasi Bonsu', email: 'akwasi@example.com', role: 'scout', phone: '0241234567', start_date: '2026-10-13', areas: [1, 2], manager: 3 }))
    expect(await screen.findByText('Invite sent to akwasi@example.com.')).toBeInTheDocument()
  })

  it('hides areas and the targets line for a Support invite and does not send areas', async () => {
    const seen = {}
    serve({ seen })
    renderPanel()
    fireEvent.click(await screen.findByRole('radio', { name: /Support/ }))
    expect(screen.queryByText('Areas (scouts)')).not.toBeInTheDocument()
    expect(screen.queryByText(/set after they join/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Nana Ofori' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nana@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    await waitFor(() => expect(seen.invite).toEqual({ full_name: 'Nana Ofori', email: 'nana@example.com', role: 'support', manager: 3 }))
  })

  it('lists pending invites with Not opened, Opened · password not set and Expired', async () => {
    serve({ data: overview({ pending: [
      invite(1, 'Kwesi Ansah', 'not_opened', { expires_at: '2026-10-09T09:00:00Z' }),
      invite(2, 'Ama Opoku', 'opened', { expires_at: '2026-10-13T09:00:00Z', areas: ['Tafo'], start_date: '2026-10-14' }),
      invite(3, 'Efia Boakye', 'expired', { role: 'support', expires_at: '2026-10-07T09:12:00Z' }),
    ] }) })
    renderPanel()
    const section = (await screen.findByRole('heading', { name: 'Pending invites' })).closest('section')
    expect(section).toHaveTextContent('3 waiting')
    const rows = within(section).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Not opened')
    expect(rows[0]).toHaveTextContent('in 2 days')
    expect(rows[1]).toHaveTextContent('Opened · password not set')
    expect(rows[1]).toHaveTextContent('Starts')
    expect(rows[1]).toHaveTextContent('Tafo')
    expect(rows[2]).toHaveTextContent('Expired')
    expect(rows[2]).toHaveTextContent('Expired today, 09:12')
    expect(rows[2]).toHaveTextContent('Support')
    expect(section).toHaveTextContent('Resend makes a new 7-day link and the old one stops working. Every invite, resend and cancel is recorded in the activity log.')
  })

  it('resends, and cancels only after a confirmation', async () => {
    const seen = {}
    serve({ seen, data: overview({ pending: [invite(1, 'Kwesi Ansah', 'not_opened')] }) })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Resend invite to Kwesi Ansah' }))
    await waitFor(() => expect(seen.resent).toBe('1'))
    expect(await screen.findByText('New link sent to 1@example.com.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invite to Kwesi Ansah' }))
    expect(screen.getByText('Cancel the invite to Kwesi Ansah? The link stops working.')).toBeInTheDocument()
    expect(seen.cancelled).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invite' }))
    await waitFor(() => expect(seen.cancelled).toBe('1'))
    expect(await screen.findByText('Invite to Kwesi Ansah cancelled.')).toBeInTheDocument()
  })

  it('shows who joined in the last 60 days and the honest empty states', async () => {
    serve({ data: overview({ joined: [{ id: 5, full_name: 'Yaw Owusu', role: 'scout', joined_at: '2026-09-15T09:00:00Z', areas: ['Bonwire', 'Ejisu'], invited_by_me: true, invited_by: 'Ama Boateng' }] }) })
    renderPanel()
    expect(await screen.findByText(/Scout · Bonwire and Ejisu/)).toBeInTheDocument()
    expect(screen.getByText('Joined Tue 15 Sept · invited by you')).toBeInTheDocument()
    expect(screen.getByText('No invites waiting.')).toBeInTheDocument()
    expect(screen.getByText(/An email with a link to .*\/staff\/activate, where they set their own password/)).toBeInTheDocument()
  })

  it('shows a refused invite\'s reason', async () => {
    serve()
    server.use(http.post(`${API}/api/accounts/staff/invite/`, () => HttpResponse.json({ email: ['staff user with this email already exists.'] }, { status: 400 })))
    renderPanel()
    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'A B' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'dup@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
  })
})
