import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import OpsTargetsPanel from '../OpsTargetsPanel.jsx'

const API = 'http://localhost:8000'
const LIMITS = [
  { metric: 'calls', min_daily: 5, max_daily: 20 }, { metric: 'registrations', min_daily: 1, max_daily: 5 },
  { metric: 'renewals', min_daily: 0, max_daily: 3 }, { metric: 'visits', min_daily: 4, max_daily: 12 },
]
const staff = (id, name, daily, over = {}) => ({ id, full_name: name, role: 'scout', daily, state: 'working', areas: ['Adum'], joined: '2026-09-01T00:00:00Z', pending_cut: null, ...over })
const DAILY = { registrations: 3, visits: 8, calls: 10, renewals: 1 }
const plans = (list) => ({ metrics: ['registrations', 'visits', 'calls', 'renewals'], today: '2026-10-07', limits: LIMITS, staff: list })
const previewRow = (id, over = {}) => ({ staff: id, week: { registrations: [18, 18], visits: [48, 48], calls: [60, 60], renewals: [6, 6] }, month: { registrations: [81, 81], visits: [216, 216], calls: [270, 270], renewals: [27, 27] }, cuts: [], month_working_days: 27, ...over })

function serve({ list, history = [], preview = (changes) => changes.map((c) => previewRow(c.staff)), seen = {} }) {
  server.use(
    http.get(`${API}/api/targets/plans/`, () => HttpResponse.json(plans(list))),
    http.get(`${API}/api/targets/history/`, () => HttpResponse.json(history)),
    http.post(`${API}/api/targets/plans/preview/`, async ({ request }) => {
      const body = await request.json()
      seen.preview = body
      return HttpResponse.json({ week: { start: '2026-10-05', end: '2026-10-11' }, month: { start: '2026-10-01', end: '2026-10-31' }, effective_from: body.effective_from, rows: preview(body.changes) })
    }),
    http.put(`${API}/api/targets/plans/`, async ({ request }) => {
      const body = await request.json()
      ;(seen.puts ||= []).push(body)
      return HttpResponse.json({ applied: Object.keys(body.values), pending_approval: null, daily: {} })
    }),
  )
}
function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><OpsTargetsPanel /></QueryClientProvider>)
}

describe('OpsTargetsPanel', () => {
  it('shows the limits, one row per scout with today\'s targets, and the team a day', async () => {
    serve({ list: [staff(1, 'Kwame Asante', DAILY), staff(2, 'Efua Mensah', { ...DAILY, registrations: 4 }), { ...staff(9, 'Esi Nyarko', DAILY), role: 'support' }] })
    renderPanel()
    expect(await screen.findByRole('heading', { name: 'Targets' })).toBeInTheDocument()
    expect(screen.getByText('Registrations 1–5')).toBeInTheDocument()
    expect(screen.getByText('Visits 4–12')).toBeInTheDocument()
    expect(screen.getByText("Set by Super Admin · you can't go outside them")).toBeInTheDocument()
    expect(screen.getByLabelText('Registrations a day for Kwame')).toHaveValue(3)
    expect(screen.getByLabelText('Registrations a day for Efua')).toHaveValue(4)
    expect(screen.queryByText('Esi Nyarko', { selector: 'div' })).not.toBeInTheDocument() // support has no targets
    const team = screen.getByText('Team a day').closest('tr')
    expect(team).toHaveTextContent('7') // 3 + 4 registrations
    expect(screen.getByLabelText('Changes apply from')).toHaveValue('2026-10-08')
    expect(screen.getByRole('button', { name: 'Save targets' })).toBeDisabled()
  })

  it('previews week and month before to after, and saves a raise from the chosen date', async () => {
    const seen = {}
    serve({ list: [staff(1, 'Kwame Asante', DAILY)], seen, preview: (changes) => changes.map((c) => previewRow(c.staff, { week: { registrations: [18, 24], visits: [48, 48], calls: [60, 60], renewals: [6, 6] }, month: { registrations: [81, 99], visits: [216, 216], calls: [270, 270], renewals: [27, 27] } })) })
    renderPanel()
    const input = await screen.findByLabelText('Registrations a day for Kwame')
    fireEvent.change(input, { target: { value: '4' } })
    expect(screen.getByText('was 3')).toBeInTheDocument()
    expect((await screen.findAllByText('18 → 24')).length).toBe(2) // the scout and the team row
    expect(screen.getAllByText('81 → 99').length).toBe(2)
    expect(screen.getByRole('columnheader', { name: /October \(27 working days\)/ })).toBeInTheDocument()
    expect(screen.getByText('Registrations raised — applies from the date above')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Visits' }))
    expect((await screen.findAllByText('48 → 48')).length).toBe(2)
    fireEvent.change(screen.getByLabelText('Changes apply from'), { target: { value: '2026-10-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save targets' }))
    await waitFor(() => expect(seen.puts).toEqual([{ staff: 1, values: { registrations: 4 }, effective_from: '2026-10-10' }]))
    expect(await screen.findByText(/1 target saved from/)).toBeInTheDocument()
  })

  it('a cut is flagged for Super Admin approval before saving, and the old target stays', async () => {
    serve({ list: [staff(3, 'Yaw Owusu', DAILY)], preview: (changes) => changes.map((c) => previewRow(c.staff, { cuts: ['registrations'], week: { registrations: [18, 14], visits: [48, 48], calls: [60, 60], renewals: [6, 6] } })) })
    renderPanel()
    fireEvent.change(await screen.findByLabelText('Registrations a day for Yaw'), { target: { value: '2' } })
    expect(await screen.findByText('Registrations cut will go to Super Admin — the current target stays until it is decided')).toBeInTheDocument()
    expect(screen.getByText('was 3 · will need approval')).toBeInTheDocument()
    expect(screen.getAllByText('18 → 14').length).toBeGreaterThanOrEqual(1)
  })

  it('shows a pending cut as waiting for approval and does not treat it as a new change', async () => {
    serve({ list: [staff(3, 'Yaw Owusu', DAILY, { pending_cut: { approval_id: 4, requested_at: '2026-10-07T10:46:00Z', metrics: { registrations: 2 } } })] })
    renderPanel()
    const input = await screen.findByLabelText('Registrations a day for Yaw')
    expect(input).toHaveValue(2)
    expect(screen.getByText('was 3 · waiting for approval')).toBeInTheDocument()
    expect(screen.getByText(/Cut sent to Super Admin on/)).toBeInTheDocument()
    expect(screen.getByText(/Yaw Owusu's cut lowers the month's total, so it went to Super Admin/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save targets' })).toBeDisabled()
  })

  it('refuses numbers outside the limits', async () => {
    serve({ list: [staff(1, 'Kwame Asante', DAILY)] })
    renderPanel()
    fireEvent.change(await screen.findByLabelText('Registrations a day for Kwame'), { target: { value: '9' } })
    expect(screen.getByText('Use 1–5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save targets' })).toBeDisabled()
  })

  it('lists recent changes from the activity log, and says so when there are none', async () => {
    serve({ list: [staff(1, 'Kwame Asante', DAILY)], history: [
      { id: 1, verb: 'targets.plan_set', at: '2026-09-01T09:00:00Z', staff_id: 2, staff_name: 'Efua Mensah', before: { registrations: 3 }, after: { values: { registrations: 4 } }, by: 'Ama', by_role: 'operations', by_me: true },
      { id: 2, verb: 'targets.limits_set', at: '2026-09-01T08:00:00Z', staff_id: null, staff_name: null, before: null, after: { visits: { min: 4, max: 12 } }, by: 'Simon Peter', by_role: 'super_admin', by_me: false },
    ] })
    renderPanel()
    const recent = (await screen.findByRole('heading', { name: 'Recent changes' })).closest('section')
    expect(within(recent).getByText('Efua Mensah · registrations 3 → 4 a day')).toBeInTheDocument()
    expect(within(recent).getByText('Limits updated: visits now 4–12')).toBeInTheDocument()
    expect(recent).toHaveTextContent('by you · recorded')
    expect(recent).toHaveTextContent('by Simon Peter (Super Admin)')
  })

  it('says no changes recorded yet and no team honestly', async () => {
    serve({ list: [] })
    renderPanel()
    expect(await screen.findByText('No scouts report to you yet.')).toBeInTheDocument()
    expect(screen.getByText('No changes recorded yet.')).toBeInTheDocument()
  })
})
