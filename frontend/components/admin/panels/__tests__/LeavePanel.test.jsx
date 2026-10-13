import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import LeavePanel from '../LeavePanel.jsx'

const API = 'http://localhost:8000'
const TEAM = [
  { id: 4, full_name: 'Kwame Asante', role: 'scout', status: 'active' },
  { id: 5, full_name: 'Esi Nyarko', role: 'support', status: 'active' },
  { id: 6, full_name: 'Pending Person', role: 'scout', status: 'invited' },
]
const leave = (id, over = {}) => ({
  id, staff: 4, staff_name: 'Kwame Asante', staff_role: 'scout', start: '2026-10-20', end: '2026-10-22', kind: 'annual', kind_label: 'Annual leave', note: '',
  recorded_by: 'Ama Boateng', recorded_by_id: 2, recorded_at: '2026-10-02T09:00:00Z', status: 'upcoming', can_change: true, working_days: 3, ...over,
})

function serve({ rows, month = rows, holidays = [], seen = {} }) {
  server.use(
    http.get(`${API}/api/accounts/staff/team/`, () => HttpResponse.json(TEAM)),
    http.get(`${API}/api/targets/holidays/`, ({ request }) => {
      const year = Number(new URL(request.url).searchParams.get('year'))
      return HttpResponse.json(holidays.filter((h) => h.date.startsWith(String(year))))
    }),
    http.get(`${API}/api/targets/leave/preview/`, ({ request }) => {
      const p = new URL(request.url).searchParams
      seen.preview = Object.fromEntries(p)
      return HttpResponse.json({ staff: Number(p.get('staff')), working_days: 2 })
    }),
    http.get(`${API}/api/targets/leave/`, ({ request }) => {
      const p = new URL(request.url).searchParams
      return HttpResponse.json(p.get('from') ? month : rows)
    }),
    http.post(`${API}/api/targets/leave/`, async ({ request }) => { seen.post = await request.json(); return HttpResponse.json(leave(99), { status: 201 }) }),
    http.patch(`${API}/api/targets/leave/:id/`, async ({ request }) => { seen.patch = await request.json(); return HttpResponse.json(leave(1)) }),
    http.delete(`${API}/api/targets/leave/:id/`, () => { seen.deleted = true; return new HttpResponse(null, { status: 204 }) }),
  )
}
function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><LeavePanel auth={{ user: { id: 2 }, hasPermission: () => true }} /></QueryClientProvider>)
}

describe('LeavePanel', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 7, 11, 46)) })
  afterEach(() => vi.useRealTimers())

  it('draws the month with leave chips, Sunday shading and a holiday read-only', async () => {
    const rows = [leave(1, { start: '2026-10-04', end: '2026-10-08', status: 'on_leave', kind: 'sick', staff_name: 'Abena Darko' }), leave(2)]
    serve({ rows, holidays: [{ id: 1, date: '2026-10-12', name: 'Test Holiday' }, { id: 2, date: '2026-12-04', name: "Farmers' Day" }] })
    renderPanel()
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
    const cell = await screen.findByRole('gridcell', { name: /^7 October, today.*Abena Darko on leave/ })
    expect(cell).toHaveTextContent('Abena D. · sick')
    expect(screen.getByRole('gridcell', { name: /^21 October.*Kwame Asante on leave/ })).toHaveTextContent('Kwame A.')
    expect(screen.getByRole('gridcell', { name: /^12 October, Test Holiday/ })).toBeInTheDocument()
    const holidays = screen.getByRole('heading', { name: 'Public holidays' }).closest('section')
    expect(holidays).toHaveTextContent('Read-only')
    expect(holidays).toHaveTextContent("Farmers' Day")
    expect(holidays).toHaveTextContent('Observed dates, kept by Super Admin')
    expect(within(holidays).queryByRole('button')).not.toBeInTheDocument()
  })

  it('says when no public holiday falls in the month, and moves between months', async () => {
    serve({ rows: [] })
    renderPanel()
    expect(await screen.findByText('No public holiday in October.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument()
    expect(screen.getByText('No public holiday in November.')).toBeInTheDocument()
  })

  it('records leave of one of the five kinds with a working-day preview', async () => {
    const seen = {}
    serve({ rows: [], seen })
    renderPanel()
    await screen.findByRole('option', { name: 'Kwame Asante (Scout)' })
    expect(screen.queryByRole('option', { name: /Pending Person/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Esi Nyarko (Support)' })).toBeInTheDocument()
    const kinds = within(screen.getByLabelText('Kind')).getAllByRole('option').map((o) => o.textContent)
    expect(kinds).toEqual(['Annual leave', 'Sick leave', 'Compassionate leave', 'Maternity or paternity leave', 'Unpaid leave'])
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'parental' } })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-30' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-31' } })
    expect(await screen.findByText('2 working days')).toBeInTheDocument()
    expect(screen.getByText(/Kwame's targets are zero on those days/)).toBeInTheDocument()
    expect(seen.preview).toMatchObject({ staff: '4', start: '2026-10-30', end: '2026-10-31' })
    fireEvent.click(screen.getByRole('button', { name: 'Record leave' }))
    await waitFor(() => expect(seen.post).toEqual({ staff: 4, kind: 'parental', start: '2026-10-30', end: '2026-10-31' }))
    expect(await screen.findByText('Leave recorded for Kwame Asante.')).toBeInTheDocument()
  })

  it('lists team leave with status, working days and who recorded it; taken leave has no actions', async () => {
    serve({ rows: [
      leave(1, { start: '2026-10-04', end: '2026-10-08', status: 'on_leave', working_days: 4 }),
      leave(3, { staff_name: 'Efua Mensah', start: '2026-09-19', end: '2026-09-20', kind: 'compassionate', kind_label: 'Compassionate leave', status: 'taken', can_change: false, working_days: 1 }),
    ] })
    renderPanel()
    const table = (await screen.findByRole('heading', { name: 'Team leave' })).closest('section')
    const current = await within(table).findByText('On leave now')
    expect(current.closest('tr')).toHaveTextContent('By you')
    expect(current.closest('tr')).toHaveTextContent('Annual leave')
    const taken = within(table).getByText('Taken').closest('tr')
    expect(taken).toHaveTextContent('Compassionate leave')
    expect(within(taken).queryByRole('button')).not.toBeInTheDocument()
    expect(within(table).getByText(/scouts Mon–Sat · support Mon–Fri/)).toBeInTheDocument()
  })

  it('changes upcoming leave and cancels it after a confirmation', async () => {
    const seen = {}
    serve({ rows: [leave(1)], seen })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Change leave for Kwame Asante' }))
    fireEvent.change(screen.getAllByLabelText('Kind').at(-1), { target: { value: 'sick' } })
    fireEvent.change(screen.getAllByLabelText('To').at(-1), { target: { value: '2026-10-23' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(seen.patch).toEqual({ kind: 'sick', start: '2026-10-20', end: '2026-10-23' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel leave for Kwame Asante' }))
    expect(screen.getByText(/targets count again on those days/)).toBeInTheDocument()
    expect(seen.deleted).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel leave' }))
    await waitFor(() => expect(seen.deleted).toBe(true))
  })

  it('leave that has started keeps its first day', async () => {
    serve({ rows: [leave(1, { start: '2026-10-05', end: '2026-10-09', status: 'on_leave' })] })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Change leave for Kwame Asante' }))
    expect(screen.getAllByLabelText('From').at(-1)).toBeDisabled()
  })

  it('has an honest empty state', async () => {
    serve({ rows: [] })
    renderPanel()
    expect(await screen.findByText(/No leave recorded for your team in the last 90 days/)).toBeInTheDocument()
  })
})

describe('LeavePanel as Super Admin', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 7, 11, 46)) })
  afterEach(() => vi.useRealTimers())

  it('covers everyone on the staff, shows the summary and lets Super Admin keep the holidays', async () => {
    const seen = {}
    serve({ rows: [leave(1, { status: 'on_leave', start: '2026-10-06', end: '2026-10-08', staff_role: 'dispatch', staff_name: 'Esi Owusu' })], holidays: [{ id: 9, name: 'Farmers Day', date: '2026-12-04' }], seen })
    server.use(
      http.get(`${API}/api/people/staff/`, () => HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 21, name: 'Akua Sarpong', role: 'marketing', status: 'active' }] })),
      http.post(`${API}/api/targets/holidays/`, async ({ request }) => { seen.holiday = await request.json(); return HttpResponse.json({ id: 10 }, { status: 201 }) }),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><LeavePanel auth={{ user: { id: 1, role: 'super_admin' }, hasPermission: () => true }} /></QueryClientProvider>)
    const kpis = await screen.findByRole('group', { name: 'Leave summary' })
    expect(within(kpis).getByText('Esi Owusu')).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /Akua Sarpong/ })).toBeInTheDocument()
    expect(screen.getByText('Away on those days')).toBeInTheDocument()
    expect(screen.queryByText('Read-only')).toBeNull()
    const form = screen.getByRole('form', { name: 'Add a public holiday' })
    fireEvent.change(within(form).getByLabelText('Holiday name'), { target: { value: 'Christmas Day' } })
    fireEvent.change(within(form).getByLabelText(/Day off/), { target: { value: '2026-12-25' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add a public holiday' }))
    await waitFor(() => expect(seen.holiday).toEqual({ name: 'Christmas Day', date: '2026-12-25' }))
  })
})
