import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import TargetsPanel, { calendarNote, periodLine } from '../TargetsPanel.jsx'

const API = 'http://localhost:8000'
const HOW = {
  registrations: 'Count when Operations approves KYC', visits: 'Count when you check out',
  calls: 'Calls you log', renewals: 'Owner pays the subscription in the app',
}
const LABEL = { registrations: 'Registrations', visits: 'Visits', calls: 'Calls', renewals: 'Renewals' }
const measure = (metric, done, target, today = [0, null]) => ({
  metric, label: LABEL[metric], how: HOW[metric], done, target, today_done: today[0], today_target: today[1],
})
const day = (n, state, extra = {}) => ({ date: `2026-10-${String(n).padStart(2, '0')}`, state, ...extra })
const week = (over = {}) => ({
  period: 'week', label: 'Mon 5 – Sun 11 October', start: '2026-10-05', end: '2026-10-11', today: '2026-10-07',
  working_days: 5, leave_days: 1, holiday_days: 0, has_targets: true,
  measures: [measure('registrations', 2, 5, [1, 1]), measure('visits', 10, 30, [3, 6]), measure('calls', 18, 50, [7, 10]), measure('renewals', 0, 5, [0, 1])],
  days: [day(5, 'done'), day(6, 'done'), day(7, 'today'), day(8, 'ahead'), day(9, 'ahead'), day(10, 'leave')],
  daily: [{ metric: 'registrations', label: 'Registrations', value: 1 }, { metric: 'visits', label: 'Visits', value: 6 }, { metric: 'calls', label: 'Calls', value: 10 }, { metric: 'renewals', label: 'Renewals', value: 1 }],
  set_by: 'Ama Boateng', effective_from: '2026-10-01', sunday_off: true,
  leave: [{ start: '2026-10-10', end: '2026-10-10', kind: 'sick', recorded_by: 'Ama Boateng' }], holidays: [], lead: { id: 2, name: 'Ama Boateng' },
  ...over,
})

function serve(build, seen = []) {
  server.use(http.get(`${API}/api/targets/me/`, ({ request }) => {
    const url = new URL(request.url)
    seen.push(url.searchParams.get('period'))
    return HttpResponse.json(build(url.searchParams.get('period')))
  }))
}
function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><TargetsPanel /></QueryClientProvider>)
}

describe('TargetsPanel', () => {
  it('shows the header, who set the targets, the period line and four measure cards with their how-copy', async () => {
    serve(() => week())
    renderPanel()
    expect(await screen.findByText('Set by Ama Boateng')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Targets' })).toBeInTheDocument()
    expect(screen.getByText('Mon 5 – Sat 10 October · 5 working days, 1 on leave')).toBeInTheDocument()
    const visits = screen.getByRole('group', { name: 'Visits' })
    expect(within(visits).getByText('Count when you check out')).toBeInTheDocument()
    expect(visits).toHaveTextContent('10 of 30')
    expect(within(visits).getByText('Today 3 of 6')).toBeInTheDocument()
    expect(within(visits).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10')
    expect(screen.getByRole('group', { name: 'Registrations' })).toHaveTextContent('Count when Operations approves KYC')
    expect(screen.getByRole('group', { name: 'Calls' })).toHaveTextContent('18 of 50')
    expect(screen.getByRole('group', { name: 'Renewals' })).toHaveTextContent('Owner pays the subscription in the app')
  })

  it('draws the working days with Done, Today, Ahead and Leave', async () => {
    serve(() => week())
    renderPanel()
    const strip = await screen.findByRole('list')
    expect(within(strip).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual([
      'Mon 5, done', 'Tue 6, done', 'Wed 7, today', 'Thu 8, working day', 'Fri 9, working day', 'Sat 10, leave, targets 0',
    ])
  })

  it('builds the leave note from the data and ends with the Sunday sentence only when Sunday is off', async () => {
    serve(() => week())
    renderPanel()
    expect(await screen.findByText("Leave on Saturday 10 October, recorded by Ama Boateng — that day's targets are 0, and so are public holidays. Sunday isn't a working day.")).toBeInTheDocument()
  })

  it('lists the daily targets with the date they started', async () => {
    serve(() => week())
    renderPanel()
    expect(await screen.findByText(/Since 1 October 2026, within the limits Super Admin sets\./)).toBeInTheDocument()
    const calls = screen.getByText('Calls', { selector: 'dt' }).parentElement
    expect(calls).toHaveTextContent('10')
  })

  it('says no targets are set, names the lead, and never shows a made-up target', async () => {
    serve(() => week({
      has_targets: false, set_by: null, effective_from: null, daily: [], leave: [], leave_days: 0, working_days: 6,
      measures: [measure('registrations', 0, null, [0, null]), measure('visits', 2, null, [1, null]), measure('calls', 0, null, [0, null]), measure('renewals', 0, null, [0, null])],
    }))
    renderPanel()
    expect(await screen.findByRole('status')).toHaveTextContent('No targets set yet — Ama Boateng sets them.')
    expect(screen.queryByText(/^Set by/)).not.toBeInTheDocument()
    expect(screen.queryByText('Your daily targets')).not.toBeInTheDocument()
    const visits = screen.getByRole('group', { name: 'Visits' })
    expect(visits).toHaveTextContent('2 · No target set')
    expect(within(visits).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText(/ of 0/)).not.toBeInTheDocument()
  })

  it('falls back to Operations when the scout has no lead on record', async () => {
    serve(() => week({ has_targets: false, lead: null, set_by: null, daily: [], effective_from: null }))
    renderPanel()
    expect(await screen.findByRole('status')).toHaveTextContent('No targets set yet — Operations sets them.')
  })

  it('shows 0 of T for a target with no work yet', async () => {
    serve(() => week({ measures: [measure('registrations', 0, 5, [0, 1]), measure('visits', 0, 30), measure('calls', 0, 50), measure('renewals', 0, 5)] }))
    renderPanel()
    expect(await screen.findByRole('group', { name: 'Registrations' })).toHaveTextContent('0 of 5')
    expect(screen.getByRole('group', { name: 'Registrations' })).toHaveTextContent('Today 0 of 1')
  })

  it('asks for the day, week or month the scout picks', async () => {
    const seen = []
    serve((period) => week({ period, label: period === 'month' ? 'October 2026' : 'x' }), seen)
    renderPanel()
    await screen.findByText('Set by Ama Boateng')
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    await waitFor(() => expect(seen).toContain('month'))
    expect(screen.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('Working days this month')).toBeInTheDocument()
  })

  it('names a public holiday from the data', async () => {
    serve(() => week({ leave: [], leave_days: 0, holiday_days: 1, holidays: [{ date: '2026-10-09', name: "Founders' Day" }], days: [day(5, 'done'), day(9, 'holiday')] }))
    renderPanel()
    expect(await screen.findByText(/Friday 9 October is a public holiday \(Founders' Day\)/)).toBeInTheDocument()
    expect(screen.getByText(/1 public holiday/)).toBeInTheDocument()
  })

  it('draws no progress bar for a target of 0', async () => {
    const base = week()
    serve(() => week({ measures: base.measures.map((m, i) => (i === 0 ? { ...m, target: 0 } : m)) }))
    renderPanel()
    await screen.findByText('Working days this week')
    expect(screen.getAllByRole('progressbar').length).toBe(base.measures.length - 1)
    expect(document.querySelector('[aria-valuemax="0"]')).toBeNull()
  })

  it('shows an error with a retry when the targets cannot load', async () => {
    server.use(http.get(`${API}/api/targets/me/`, () => HttpResponse.json({ detail: 'boom' }, { status: 500 })))
    renderPanel()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your targets.")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('periodLine and calendarNote', () => {
  it('says "1 working day" in the singular and omits leave and holiday when there are none', () => {
    expect(periodLine({ period: 'day', label: 'Wed 7 October', days: [], working_days: 1, leave_days: 0, holiday_days: 0 })).toBe('Wed 7 October · 1 working day')
  })
  it('is empty when Sunday is a working day and nothing else is off', () => {
    expect(calendarNote({ leave: [], holidays: [], sunday_off: false })).toBe('')
  })
  it('uses the singular canvas wording for one leave day', () => {
    expect(calendarNote({ leave: [{ start: '2026-10-10', end: '2026-10-10', recorded_by: 'Ama' }], holidays: [], sunday_off: false }))
      .toBe("Leave on Saturday 10 October, recorded by Ama — that day's targets are 0, and so are public holidays.")
  })
  it('describes a leave that spans several days', () => {
    expect(calendarNote({ leave: [{ start: '2026-10-05', end: '2026-10-07', recorded_by: 'Ama' }], holidays: [], sunday_off: false }))
      .toBe("Leave from Monday 5 October to Wednesday 7 October, recorded by Ama — those days' targets are 0.")
  })
})
