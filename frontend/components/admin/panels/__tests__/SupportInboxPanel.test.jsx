import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SupportInboxPanel from '../SupportInboxPanel.jsx'

const API = 'http://localhost:8000'
const row = (over = {}) => ({
  id: 7, kind: 'customer', kind_label: 'Customer', display_name: 'Yaw Mensah', person_name: 'Yaw Mensah', status: 'open', priority: 'high',
  assignee: { id: 1, name: 'Esi Nyarko' }, about: { business: { id: 4, name: 'Akosua Ntoma Kente' }, listing: null, order: { id: 1 }, label: 'Akosua Ntoma Kente · Order #1' },
  last_message: { body: 'Please can the rider call me?', sender_type: 'customer', at: '2026-10-07T11:40:00Z' }, snoozed: false, past_limit: false,
  sla: { kind: 'resolve', due: '2026-10-07T19:00:00Z', seconds_left: 3600 }, first_reply_at: '2026-10-07T11:14:00Z', first_reply_due: null, resolve_due: '2026-10-07T19:00:00Z',
  tags: [], unassigned_reason: '', resolved_at: null, resolved_by: null, resolution_code: '', resolution_note: '', snoozed_until: null, ...over,
})
const thread = (over = {}) => ({
  ...row(), messages: [
    { id: 1, kind: 'message', sender_type: 'customer', body: 'Is it still coming today?', created_at: '2026-10-07T11:02:00Z' },
    { id: 2, kind: 'note', sender_type: 'staff', body: 'Rider is in traffic', author_name: 'Esi Nyarko', created_at: '2026-10-07T11:16:00Z' },
    { id: 3, kind: 'event', sender_type: 'staff', body: 'Order #1 picked up', created_at: '2026-10-07T10:55:00Z' },
  ], ...over,
})
const context = {
  conversation: 7, earlier: [], calls: [], tags: [], order: { id: 1, total_amount: '420.00', status_label: 'Paid', delivery_status_label: 'Shipped', delivery: null },
  party: { kind: 'customer', id: 3, name: 'Yaw Mensah', phone_masked: '024 *** 553', orders: 3 }, business: null, listing: null,
}

function setup({ rows = [row()], th = thread(), scope = 'mine', ctx = context } = {}) {
  const seen = { posts: [], urls: [] }
  server.use(
    http.get(`${API}/api/messaging/staff/`, ({ request }) => { seen.urls.push(request.url); return HttpResponse.json({ count: rows.length, results: rows, counts: {}, summary: { total: rows.length, past_limit: 0, first_reply_today_count: 2, first_reply_today_avg_seconds: 540 } }) }),
    http.get(`${API}/api/messaging/staff/team/`, () => HttpResponse.json({ me: { id: 1 }, agents: [{ id: 1, name: 'Esi Nyarko', open: 2, capacity: 6, full: false, available: true, note: 'Has room' }], capacity: 6, round_robin: true })),
    http.get(`${API}/api/messaging/staff/limits/`, () => HttpResponse.json({ first_reply_minutes: { high: 15, medium: 30, low: 60 }, resolve_minutes: { high: 480, medium: 1440, low: 2880 }, opens_at: '08:00', closes_at: '20:00' })),
    http.get(`${API}/api/messaging/staff/canned/`, () => HttpResponse.json([{ id: 9, title: 'Rider running late', shortcut: '/late', body: 'Hi Yaw, Kofi is late by {eta}.', audience: 'customer' }])),
    http.get(`${API}/api/messaging/staff/tags/`, () => HttpResponse.json([{ id: 1, name: 'delivery' }])),
    http.get(`${API}/api/messaging/staff/:id/`, () => HttpResponse.json(th)),
    http.get(`${API}/api/messaging/staff/:id/context/`, () => HttpResponse.json(ctx)),
    http.post(`${API}/api/messaging/staff/:id/:action/`, async ({ request, params }) => { seen.posts.push([params.action, await request.json()]); return HttpResponse.json({ id: 1, ...th }) }),
    http.post(`${API}/api/messaging/staff/assign/`, async ({ request }) => { seen.posts.push(['bulk', await request.json()]); return HttpResponse.json({ assigned: [7] }) }),
    http.post(`${API}/api/messaging/staff/canned/:id/use/`, () => HttpResponse.json({ uses: 1 })),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><SupportInboxPanel scope={scope} auth={{ user: { id: 1 } }} /></QueryClientProvider>)
  return seen
}

describe('SupportInboxPanel', () => {
  it('lists the scope, shows the thread with notes and events apart, and the context', async () => {
    const seen = setup()
    expect(await screen.findByRole('heading', { name: 'Mine' })).toBeInTheDocument()
    expect(new URL(seen.urls[0]).searchParams.get('scope')).toBe('mine')
    expect(await screen.findByText(/internal note, never sent/)).toBeInTheDocument()
    expect(screen.getByText('Order #1 picked up')).toBeInTheDocument()
    expect(screen.getByText(/With AshantiHub Support about Akosua Ntoma Kente/)).toBeInTheDocument()
    expect(await screen.findByText(/024 \*\*\* 553/)).toBeInTheDocument()
    expect(screen.getByText(/first reply today 9 min average/)).toBeInTheDocument()
  })

  it('sends a reply as Support, and blocks while a canned field is unresolved', async () => {
    const seen = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Canned replies' }))
    fireEvent.click(await screen.findByText('Rider running late'))
    expect(screen.getByRole('button', { name: 'Send as AshantiHub Support' })).toBeDisabled()
    expect(screen.getByText(/Type it in before sending/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Reply to Yaw Mensah'), { target: { value: 'Hi Yaw, Kofi is late by 12:15.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send as AshantiHub Support' }))
    await waitFor(() => expect(seen.posts.some(([a, b]) => a === 'reply' && b.body.includes('12:15'))).toBe(true))
  }, 20000)

  it('saves an internal note instead of a reply', async () => {
    const seen = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Internal note' }))
    fireEvent.change(screen.getByLabelText('Internal note', { selector: 'textarea' }), { target: { value: 'Check with Kofi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    await waitFor(() => expect(seen.posts.some(([a]) => a === 'note')).toBe(true))
    expect(seen.posts.some(([a]) => a === 'reply')).toBe(false)
  })

  it('resolves with a reason', async () => {
    const seen = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve' }))
    fireEvent.change(screen.getByLabelText('How was it resolved?'), { target: { value: 'item_sent' } })
    fireEvent.click(within(screen.getByLabelText('How was it resolved?').closest('div')).getByRole('button', { name: 'Resolve' }))
    await waitFor(() => expect(seen.posts).toContainEqual(['resolve', { code: 'item_sent', note: '' }]))
  })

  it('unassigned: previews, assigns to me and offers bulk assign', async () => {
    const seen = setup({ scope: 'unassigned', rows: [row({ assignee: null, unassigned_reason: 'Nobody had room' })], th: thread({ assignee: null }) })
    expect(await screen.findByText('Nobody had room')).toBeInTheDocument()
    expect(await screen.findByText('Previewing. Take it to reply.')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Select Yaw Mensah'))
    fireEvent.change(screen.getByLabelText('Assign selected to'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign 1' }))
    await waitFor(() => expect(seen.posts.some(([a, b]) => a === 'assign' && b.assignee === 1)).toBe(true))
  })

  it('past time limit: shows the limits table and an escalate box', async () => {
    const seen = setup({ scope: 'past', rows: [row({ past_limit: true, assignee: { id: 2, name: 'Nana Yaa Ofori' }, sla: { kind: 'resolve', due: 'x', seconds_left: -600 } })], th: thread({ past_limit: true, assignee: { id: 2, name: 'Nana Yaa Ofori' } }) })
    expect(await screen.findByText('10 min over')).toBeInTheDocument()
    expect(await screen.findByText('Time limits · set by Operations')).toBeInTheDocument()
    expect(await screen.findByText(/Nana Yaa Ofori owns this/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Escalate: what do you need/), { target: { value: 'Please chase the shop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Escalate' }))
    await waitFor(() => expect(seen.posts).toContainEqual(['escalate', { message: 'Please chase the shop' }]))
  })

  it('a resolved conversation can be reopened and has no composer', async () => {
    const seen = setup({ scope: 'resolved', rows: [row({ status: 'closed', resolved_at: '2026-10-07T10:40:00Z' })], th: thread({ status: 'closed', resolved_at: '2026-10-07T10:40:00Z' }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Reopen' }))
    await waitFor(() => expect(seen.posts.some(([a]) => a === 'reopen')).toBe(true))
    expect(screen.queryByRole('button', { name: 'Send as AshantiHub Support' })).not.toBeInTheDocument()
  })
})
