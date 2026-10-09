import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ScoutTodayPanel, { bonusLine, greeting, waitingLine } from '../ScoutTodayPanel.jsx'

const API = 'http://localhost:8000'
const hours = (n) => new Date(Date.now() + n * 3600000).toISOString()
const PERMS = ['businesses.register', 'businesses.manage_portfolio', 'calls.log', 'commission.view_own']
const user = (over = {}) => ({ id: 9, full_name: 'Kwame Asante', role: 'scout', areas: ['Asafo', 'Bantama'], portfolio_count: 14, manager: { id: 2, full_name: 'Ama Boateng', role: 'operations' }, ...over })
const authOf = (u = user(), perms = PERMS) => ({ user: u, hasPermission: (c) => perms.includes(c) })

const measure = (metric, label, done, target, todayDone, todayTarget) => ({ metric, label, how: '', done, target, today_done: todayDone, today_target: todayTarget })
const targets = (period, rows, over = {}) => ({
  period, label: 'x', start: '2026-10-05', end: '2026-10-11', today: '2026-10-07', working_days: 6, leave_days: 0, holiday_days: 0, has_targets: true,
  measures: rows, days: [], daily: [], set_by: 'Ama Boateng', effective_from: '2026-10-01', sunday_off: true, leave: [], holidays: [], lead: { id: 2, name: 'Ama Boateng' }, ...over,
})
const WEEK = targets('week', [
  measure('registrations', 'Registrations', 2, 5, 1, 1), measure('visits', 'Visits', 10, 30, 3, 6),
  measure('calls', 'Calls', 18, 50, 7, 10), measure('renewals', 'Renewals', 1, 5, 0, 1),
])
const MONTH = targets('month', [
  measure('registrations', 'Registrations', 5, 26, 1, 1), measure('visits', 'Visits', 33, 156, 3, 6),
  measure('calls', 'Calls', 55, 260, 7, 10), measure('renewals', 'Renewals', 4, 26, 0, 1),
])
const task = (over = {}) => ({
  id: 1, title: 'Promised to pay by Friday', notes: '', due_at: hours(-30), status: 'open', kind: 'subscription_overdue',
  business: { id: 12, name: 'Adwoa Fabrics' }, prospect: null, order_id: null, overdue: { day: 4, pause_enabled: false, hide_on: null, grace_days: 14 }, created_by_name: null, ...over,
})
const approval = (id, kind_label) => ({ id, kind: 'k', kind_label, title: 'T', status: 'pending', maker: { id: 9, full_name: 'Kwame', role: 'scout' } })
const commission = (over = {}) => ({
  count: 3, next: null, previous: null, results: [], statement: { from: '2026-10-01', to: '2026-10-07' },
  totals: Object.fromEntries(['on_hold', 'payable', 'in_batch', 'paid', 'reversed'].map((k) => [k, { amount: '0.00', count: 0, registrations: 0, bonuses: 0 }])),
  bonus: [], bonus_more: 0, policy: { registration: { amount: '50.00', effective_from: '2026-01-01' }, three_paid_months_bonus: { amount: '100.00', effective_from: '2026-01-01' } }, ...over,
})

function serve({ week = WEEK, month = MONTH, tasks = {}, approvals = [], comm = commission() } = {}) {
  server.use(
    http.get(`${API}/api/targets/me/`, ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('period') === 'month' ? month : week)),
    http.get(`${API}/api/tasks/`, ({ request }) => HttpResponse.json(tasks[new URL(request.url).searchParams.get('view')] || [])),
    http.get(`${API}/api/approvals/`, () => HttpResponse.json({ count: approvals.length, next: null, previous: null, results: approvals })),
    http.get(`${API}/api/commission/me/`, () => HttpResponse.json(comm)),
  )
}
function renderPanel(props = {}) {
  const handlers = { onNavigate: vi.fn(), onCheckIn: vi.fn(), onRegister: vi.fn(), onSeeApprovals: vi.fn(), onOpenBusiness: vi.fn() }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><ScoutTodayPanel auth={authOf()} {...handlers} {...props} /></QueryClientProvider>)
  return handlers
}
const card = (name) => screen.getByRole('region', { name })

describe('ScoutTodayPanel', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-07T08:30:00')) })
  afterEach(() => vi.useRealTimers())

  it('greets by the hour and names the day and the scout\'s areas', async () => {
    serve()
    renderPanel()
    expect(screen.getByRole('heading', { name: 'Good morning, Kwame' })).toBeInTheDocument()
    expect(screen.getByText('Wednesday 7 October · Asafo & Bantama')).toBeInTheDocument()
    expect(greeting(8)).toBe('Good morning')
    expect(greeting(13)).toBe('Good afternoon')
    expect(greeting(19)).toBe('Good evening')
    expect(await screen.findByText('Registrations count when Operations approves KYC. Renewals count when the owner pays in the app.')).toBeInTheDocument()
  })

  it('leaves the area out when the scout manages no businesses yet', async () => {
    serve()
    renderPanel({ auth: authOf(user({ areas: [], portfolio_count: 0 })) })
    expect(screen.getByText('Wednesday 7 October')).toBeInTheDocument()
  })

  it('shows four target rows, today against the target with the week and month beside it', async () => {
    serve()
    renderPanel()
    const visits = await within(card("Today's targets")).findByRole('group', { name: 'Visits' })
    expect(visits).toHaveTextContent('3 / 6')
    expect(visits).toHaveTextContent('Week 10 of 30 · October 33 of 156')
    expect(within(visits).getByRole('progressbar', { name: 'Visits today' })).toHaveAttribute('aria-valuenow', '3')
    expect(within(card("Today's targets")).getAllByRole('group')).toHaveLength(4)
  })

  it('says "No targets set yet" and never shows a made-up target', async () => {
    const none = targets('week', ['registrations', 'visits', 'calls', 'renewals'].map((m) => measure(m, m, 0, null, 0, null)), { has_targets: false })
    serve({ week: none, month: { ...none, period: 'month' } })
    renderPanel()
    expect(await screen.findByText('No targets set yet')).toBeInTheDocument()
    expect(screen.getByText(/Ama Boateng sets them/)).toBeInTheDocument()
    expect(within(card("Today's targets")).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(within(card("Today's targets")).queryByText(/ of 0| \/ 0/)).not.toBeInTheDocument()
  })

  it('opens Targets, Check in and Register from the screen, each only with its permission', async () => {
    serve()
    const h = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Check in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Register a business' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Targets' }))
    expect(h.onCheckIn).toHaveBeenCalledTimes(1)
    expect(h.onRegister).toHaveBeenCalledTimes(1)
    expect(h.onNavigate).toHaveBeenCalledWith('targets')
    expect(screen.getByText('Your location is recorded only when you check in or out.')).toBeInTheDocument()
  })

  it('hides Check in without a portfolio or verification permission', async () => {
    serve()
    renderPanel({ auth: authOf(user(), ['businesses.register']) })
    expect(screen.queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Register a business' })).toBeInTheDocument()
  })

  it('lists the top three due follow-ups, overdue first, with the pause-off label, and counts them all', async () => {
    serve({ tasks: {
      overdue: [task({ id: 1 }), task({ id: 2, kind: 'returned_approval', title: 'Ama asked for a photo', business: { id: 5, name: "Nana's Chop Bar" }, overdue: null, created_by_name: 'Ama Boateng' })],
      due_today: [task({ id: 3, kind: 'delivery_problem', order_id: 31, title: 'Customer not reachable', business: { id: 6, name: 'Kente Hub' }, overdue: null }), task({ id: 4, kind: 'manual', business: null, title: 'Fourth one' })],
      open: [task({ id: 1 }), task({ id: 2 }), task({ id: 3 }), task({ id: 4 }), task({ id: 5 }), task({ id: 6 })],
    } })
    const h = renderPanel()
    const due = card('Due follow-ups')
    expect(await within(due).findByText('Overdue · day 4')).toBeInTheDocument()
    expect(within(due).queryByText(/of 14/)).not.toBeInTheDocument()
    expect(within(due).getByText('From Ama Boateng')).toBeInTheDocument()
    expect(within(due).getByText('Order #31')).toBeInTheDocument()
    expect(within(due).queryByText('Fourth one')).not.toBeInTheDocument()
    expect(within(due).getByRole('button', { name: 'Open all follow-ups' })).toHaveTextContent('All 6 · 2 overdue')
    fireEvent.click(within(due).getByRole('button', { name: 'Open Adwoa Fabrics' }))
    expect(h.onOpenBusiness).toHaveBeenCalledWith(12)
    fireEvent.click(within(due).getByRole('button', { name: 'Open all follow-ups' }))
    expect(h.onNavigate).toHaveBeenCalledWith('tasks')
  })

  it('says honestly that nothing is due', async () => {
    serve()
    renderPanel()
    expect(await within(card('Due follow-ups')).findByText(/Nothing due — follow-ups appear here when a subscription is overdue/)).toBeInTheDocument()
  })

  it('titles the approvals card with the lead and counts what is waiting by kind', async () => {
    serve({ approvals: [approval(1, 'New business (KYC)'), approval(2, 'Business details change'), approval(3, 'New product or service')] })
    const h = renderPanel()
    const waiting = card('Waiting for approval')
    expect(await within(waiting).findByText('1 registration · 1 change · 1 new product')).toBeInTheDocument()
    expect(within(waiting).getByRole('heading', { name: 'Waiting for Ama Boateng' })).toBeInTheDocument()
    fireEvent.click(within(waiting).getByRole('button', { name: 'See all requests I made' }))
    expect(h.onSeeApprovals).toHaveBeenCalled()
  })

  it('has an honest empty state for approvals and falls back to "your lead"', async () => {
    serve()
    renderPanel({ auth: authOf(user({ manager: null })) })
    const waiting = card('Waiting for approval')
    expect(await within(waiting).findByText(/Nothing is waiting/)).toBeInTheDocument()
    expect(within(waiting).getByRole('heading', { name: 'Waiting for your lead' })).toBeInTheDocument()
    expect(within(waiting).queryByRole('button', { name: /See all/ })).not.toBeInTheDocument()
  })

  it('shows commission on hold and approved to pay, and the bonus closest to done', async () => {
    const comm = commission({
      totals: { ...commission().totals, on_hold: { amount: '450.00', count: 9, registrations: 9, bonuses: 0 }, payable: { amount: '300.00', count: 3, registrations: 2, bonuses: 1 } },
      bonus: [{ business: 'Nana\'s Chop Bar', business_id: 9, paid_months: 0, state: { kind: 'trial_until', date: '2026-11-06' } }, { business: 'Adwoa Fabrics', business_id: 7, paid_months: 2, state: { kind: 'overdue', day: 4 } }],
    })
    serve({ comm })
    const h = renderPanel()
    const box = card('My commission')
    expect(await within(box).findByText('GH₵ 450.00')).toBeInTheDocument()
    expect(within(box).getByText('GH₵ 300.00')).toBeInTheDocument()
    expect(within(box).getByText('On hold (90 days)')).toBeInTheDocument()
    expect(within(box).getByText('Approved to pay')).toBeInTheDocument()
    expect(within(box).getByRole('heading', { name: 'My commission · October' })).toBeInTheDocument()
    expect(box).toHaveTextContent('Adwoa Fabrics is at 2 of 3 — its overdue renewal would complete it.')
    fireEvent.click(within(box).getByRole('button', { name: 'Open the commission statement' }))
    expect(h.onNavigate).toHaveBeenCalledWith('commission')
  })

  it('says nothing is earned when no commission policy is approved', async () => {
    serve({ comm: commission({ count: 0, policy: { registration: null, three_paid_months_bonus: null } }) })
    renderPanel()
    expect(await within(card('My commission')).findByText('No commission policy is approved yet, so nothing is earned yet.')).toBeInTheDocument()
    expect(within(card('My commission')).queryByText(/GH₵/)).not.toBeInTheDocument()
  })

  it('reports a card that cannot load without breaking the others', async () => {
    serve()
    server.use(http.get(`${API}/api/commission/me/`, () => HttpResponse.json({ detail: 'boom' }, { status: 500 })))
    renderPanel()
    expect(await within(card('My commission')).findByRole('alert')).toHaveTextContent("Couldn't load your commission.")
    expect(await within(card("Today's targets")).findByRole('group', { name: 'Visits' })).toBeInTheDocument()
  })
})

describe('waitingLine and bonusLine', () => {
  it('groups kinds, pluralises and counts what the first page hides', () => {
    const rows = [approval(1, 'New business (KYC)'), approval(2, 'New business (KYC)'), approval(3, 'Listing photos')]
    expect(waitingLine(rows, 5)).toBe('2 registrations · 1 photo set · 2 more')
  })
  it('only says "would complete it" at 2 of 3 with a renewal to come', () => {
    expect(bonusLine({ business: 'A', paid_months: 2, state: { kind: 'next_renewal', date: '2026-11-02' } })).toBe('A is at 2 of 3 — its next renewal would complete it.')
    expect(bonusLine({ business: 'A', paid_months: 1, state: { kind: 'overdue', day: 3 } })).toBe('A is at 1 of 3.')
  })

  it('hides the Commission and Targets cards, with no error card, without their permissions', async () => {
    serve()
    renderPanel({ auth: authOf(user(), ['calls.log']) })
    expect(await screen.findByRole('region', { name: 'Due follow-ups' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'My commission' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: "Today's targets" })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
