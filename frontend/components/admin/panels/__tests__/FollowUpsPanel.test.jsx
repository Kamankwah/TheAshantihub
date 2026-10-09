import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import FollowUpsPanel, { dueLabel } from '../FollowUpsPanel.jsx'

const API = 'http://localhost:8000'
const hours = (n) => new Date(Date.now() + n * 3600000).toISOString()
const task = (over = {}) => ({
  id: 1, title: 'Follow up: Adwoa Fabrics', notes: '', due_at: hours(2), status: 'open', done_at: null, kind: 'call_follow_up',
  business: { id: 12, name: 'Adwoa Fabrics' }, prospect: null, order_id: null, overdue: null, created_by_name: null,
  source_type: 'calls.calllog', source_id: '5', created_at: hours(-5), ...over,
})

// The three views the panel reads: overdue, due_today (never overlapping it) and upcoming.
function serve({ overdue = [], today = [], upcoming = [] } = {}, seen = []) {
  server.use(http.get(`${API}/api/tasks/`, ({ request }) => {
    const view = new URL(request.url).searchParams.get('view')
    seen.push(view)
    return HttpResponse.json({ overdue, due_today: today, upcoming }[view] || [])
  }))
}
function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><FollowUpsPanel {...props} /></QueryClientProvider>)
}

describe('dueLabel', () => {
  const base = { due_at: '2026-10-09T16:00:00', kind: 'call_follow_up' }
  it('says "Overdue · day N" with no "of 14" while the pause is switched off', () => {
    const sub = { ...base, kind: 'subscription_overdue', overdue: { day: 4, pause_enabled: false, hide_on: null, grace_days: 14 } }
    expect(dueLabel(sub, 'today')).toBe('Overdue · day 4')
    expect(dueLabel(sub, 'today')).not.toMatch(/of 14|hidden|hide/i)
  })
  it('counts "Day N of 14" only when the pause is on', () => {
    const sub = { ...base, kind: 'subscription_overdue', overdue: { day: 4, pause_enabled: true, hide_on: '2026-10-18', grace_days: 14 } }
    expect(dueLabel(sub, 'today')).toBe('Day 4 of 14')
  })
  it('names who returned an approval, the order of a delivery problem, else the time or the day', () => {
    expect(dueLabel({ ...base, kind: 'returned_approval', created_by_name: 'Ama Boateng' }, 'today')).toBe('From Ama Boateng')
    expect(dueLabel({ ...base, kind: 'ops_follow_up', created_by_name: 'Ama Boateng' }, 'upcoming')).toBe('From Ama Boateng')
    expect(dueLabel({ ...base, kind: 'delivery_problem', order_id: 31 }, 'today')).toBe('Order #31')
    expect(dueLabel(base, 'today')).toMatch(/^\d\d:\d\d$/)
    expect(dueLabel(base, 'upcoming')).toBe('Fri 9 Oct')
  })
  it('falls back to the date when the subscription is no longer overdue', () => {
    expect(dueLabel({ ...base, kind: 'subscription_overdue', overdue: null }, 'overdue')).toBe('Fri 9 Oct')
  })
})

describe('FollowUpsPanel', () => {
  it('names the lead in the footer once /me carries it, and falls back to "your lead"', async () => {
    serve()
    renderPanel({ leadName: 'Ama Boateng' })
    expect(await screen.findByText(/approvals Ama Boateng returns, and follow-up dates you set\./)).toBeInTheDocument()
  })

  it('splits Overdue / Today / Coming up from the three views and counts them', async () => {
    const seen = []
    serve({
      overdue: [task({ id: 1, title: 'Call back', business: { id: 3, name: 'Bantama Cold Store' }, due_at: hours(-50) }), task({ id: 2, kind: 'prospect_follow_up', business: null, prospect: { id: 9, name: 'Waakye Joint' }, title: 'Follow up: Waakye Joint', due_at: hours(-80) })],
      today: [task({ id: 3 }), task({ id: 4, kind: 'delivery_problem', order_id: 31, title: 'Customer not reachable', business: { id: 5, name: "Nana's Chop Bar" } })],
      upcoming: [task({ id: 5, title: 'Check renewal', due_at: hours(60) })],
    }, seen)
    renderPanel()
    expect(screen.getByRole('heading', { name: 'Follow-ups' })).toBeInTheDocument()
    expect(await screen.findByText('2 overdue · 2 today · 1 coming up')).toBeInTheDocument()
    expect(new Set(seen)).toEqual(new Set(['overdue', 'due_today', 'upcoming']))
    expect(within(screen.getByRole('region', { name: 'Overdue' })).getAllByText(/Call follow-up|Prospect follow-up/)).toHaveLength(2)
    const today = screen.getByRole('region', { name: 'Today' })
    expect(within(today).getByText('Delivery problem', { selector: 'span' })).toBeInTheDocument()
    expect(within(today).getByText('Order #31')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Coming up' })).getByText('Check renewal')).toBeInTheDocument()
    expect(screen.getByText(/Added automatically from overdue subscriptions, delivery problems, approvals your lead returns, and follow-up dates you set\./)).toBeInTheDocument()
  })

  it('shows a chip per source and the pause-off label, with no countdown', async () => {
    serve({ today: [
      task({ id: 1, kind: 'subscription_overdue', title: 'Remind Adwoa to renew', overdue: { day: 4, pause_enabled: false, hide_on: null, grace_days: 14 } }),
      task({ id: 2, kind: 'returned_approval', created_by_name: 'Ama Boateng', title: 'Returned: Change hours', notes: 'Add a photo of the signboard.' }),
    ] })
    renderPanel()
    const today = await screen.findByRole('region', { name: 'Today' })
    expect(within(today).getByText('Subscription overdue')).toBeInTheDocument()
    expect(within(today).getByText('Overdue · day 4')).toBeInTheDocument()
    expect(within(today).getByText('Returned approval')).toBeInTheDocument()
    expect(within(today).getByText('From Ama Boateng')).toBeInTheDocument()
    expect(within(today).getByText('Add a photo of the signboard.')).toBeInTheDocument()
    expect(screen.queryByText(/of 14/)).not.toBeInTheDocument()
  })

  it('opens the business page from its link, and the prospects list from a prospect task', async () => {
    serve({ today: [task({ id: 1 }), task({ id: 2, kind: 'prospect_follow_up', business: null, prospect: { id: 9, name: 'Waakye Joint' }, title: 'Bring the price sheet' })] })
    const onOpenBusiness = vi.fn()
    const onOpenProspects = vi.fn()
    renderPanel({ onOpenBusiness, onOpenProspects })
    fireEvent.click(await screen.findByRole('button', { name: 'Adwoa Fabrics' }))
    expect(onOpenBusiness).toHaveBeenCalledWith(12)
    fireEvent.click(screen.getByRole('button', { name: 'Waakye Joint' }))
    expect(onOpenProspects).toHaveBeenCalled()
  })

  it('marks a task done and refetches the sections', async () => {
    let done = false
    const seen = []
    server.use(
      http.get(`${API}/api/tasks/`, ({ request }) => {
        const view = new URL(request.url).searchParams.get('view')
        seen.push(view)
        return HttpResponse.json(view === 'due_today' && !done ? [task({ id: 7 })] : [])
      }),
      http.post(`${API}/api/tasks/7/done/`, () => { done = true; return HttpResponse.json(task({ id: 7, status: 'done' })) }),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Mark done: Adwoa Fabrics' }))
    await waitFor(() => expect(done).toBe(true))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Mark done/ })).not.toBeInTheDocument())
    expect(seen.filter((v) => v === 'due_today').length).toBeGreaterThan(1)
    expect(screen.getByText(/Nothing to follow up right now/)).toBeInTheDocument()
  })

  it('shows why a task could not be marked done', async () => {
    serve({ today: [task({ id: 7 })] })
    server.use(http.post(`${API}/api/tasks/7/done/`, () => HttpResponse.json({ detail: 'Not found.' }, { status: 404 })))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Mark done: Adwoa Fabrics' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Not found|Could not mark/)
  })

  it('adds a follow-up for a day', async () => {
    serve()
    const bodies = []
    server.use(http.post(`${API}/api/tasks/`, async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json(task({ id: 9, kind: 'manual' }), { status: 201 }) }))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: '+ Add a follow-up' }))
    fireEvent.change(screen.getByLabelText('What to follow up'), { target: { value: 'Bring the price list' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].title).toBe('Bring the price list')
    expect(new Date(bodies[0].due_at).getTime()).toBeGreaterThan(Date.now() - 1000)
  })

  it('says so when there is nothing, and when it cannot load', async () => {
    serve()
    renderPanel()
    expect(await screen.findByText(/Nothing to follow up right now/)).toBeInTheDocument()
    expect(screen.queryByText(/overdue ·/)).toBeInTheDocument()
  })

  it('offers Try again when the list cannot load', async () => {
    server.use(http.get(`${API}/api/tasks/`, () => HttpResponse.json({ detail: 'x' }, { status: 500 })))
    renderPanel()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your follow-ups.")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
