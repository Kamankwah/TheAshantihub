import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ScheduledExportsPanel from '../ScheduledExportsPanel.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

const schedule = (over = {}) => ({
  id: 1, name: 'Weekly sales', kind: 'revenue', kind_label: 'Revenue & sales', description: '', filters: { period: 'last_week' }, format: 'xlsx', frequency: 'weekly', weekday: 1, day_of_month: null,
  run_time: '07:00', personal_data: false, recipients: [{ id: 9, full_name: 'Kofi Ofori', role: 'accountant' }], status: 'active', paused_at: null, paused_by: null,
  next_run_at: '2026-10-20T07:00:00Z', last_run_at: '2026-10-13T07:00:00Z', created_by: 'Simon', password_confirmed_at: null,
  last_run: { id: 4, status: 'ok', started_at: '2026-10-13T07:00:00Z', rows: 12, error: '' }, runs: [], ...over,
})
const kinds = [
  { key: 'revenue', label: 'Revenue & sales', description: 'Revenue by type', personal_data: false, presets: [{ key: 'last_week', label: 'Last week (Monday to Sunday)' }, { key: 'last_month', label: 'Last month' }] },
  { key: 'commission_statements', label: 'Commission statements', description: 'Earned lines', personal_data: true, presets: [] },
  { key: 'growth_funnel', label: 'Growth funnel', description: 'Visit to paid', personal_data: false, presets: [{ key: 'last_90_days', label: 'The last 90 days' }] },
]
const payload = (over = {}) => ({
  schedules: [schedule(), schedule({ id: 2, name: 'Statements', kind: 'commission_statements', kind_label: 'Commission statements', filters: {}, personal_data: true, status: 'paused', paused_by: 'Simon', next_run_at: null, password_confirmed_at: '2026-09-28T10:00:00Z', last_run: null, last_run_at: null })],
  kinds, team_options: [{ id: 5, name: "Ama's scouts" }],
  kpis: { active: 1, active_personal: 0, paused: 1, runs_7_days: 3, runs_with_problems: 1, never_opened: 2 },
  staff: [{ id: 9, full_name: 'Kofi Ofori', role: 'accountant' }, { id: 4, full_name: 'Kwame Asante', role: 'scout' }],
  ...over,
})

describe('ScheduledExportsPanel', () => {
  it('lists schedules with who gets them, personal data, status and honest run counts', async () => {
    server.use(http.get(`${API}/api/insights/exports/`, () => HttpResponse.json(payload())), http.get(`${API}/api/insights/exports/files/mine/`, () => HttpResponse.json([])))
    wrap(<ScheduledExportsPanel />)
    expect(await screen.findByText('Weekly sales')).toBeInTheDocument()
    expect(screen.getAllByText('Tuesdays 07:00').length).toBeGreaterThan(0)
    expect(screen.getByRole('group', { name: 'Runs in the last 7 days' })).toHaveTextContent('1 had problems')
    const row = screen.getByText('Statements').closest('tr')
    expect(within(row).getByText('Paused')).toBeInTheDocument()
    expect(within(row).getByText('Yes')).toBeInTheDocument()
    expect(within(row).getByText(/Password re-entered/)).toBeInTheDocument()
    expect(screen.getByText(/never attached to emails|never attached/)).toBeInTheDocument()
  })

  it('creates a schedule and warns before saving one with personal data', async () => {
    const posted = []
    server.use(
      http.get(`${API}/api/insights/exports/`, () => HttpResponse.json(payload({ schedules: [] }))),
      http.get(`${API}/api/insights/exports/files/mine/`, () => HttpResponse.json([])),
      http.post(`${API}/api/insights/exports/`, async ({ request }) => { posted.push(await request.json()); return HttpResponse.json(schedule(), { status: 201 }) }),
    )
    wrap(<ScheduledExportsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'New schedule' }))
    const form = await screen.findByRole('form', { name: 'New schedule' })
    expect(within(form).queryByText(/includes personal data/)).not.toBeInTheDocument()
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Statements' } })
    fireEvent.change(within(form).getByLabelText(/^What/), { target: { value: 'commission_statements' } })
    expect(within(form).getByText(/includes personal data. You will be asked for your password/)).toBeInTheDocument()
    fireEvent.click(within(form).getByLabelText(/Kwame Asante/))
    fireEvent.change(within(form).getByLabelText('Every'), { target: { value: 'monthly' } })
    fireEvent.change(within(form).getByLabelText('Day of the month'), { target: { value: '2' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save schedule' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ name: 'Statements', kind: 'commission_statements', frequency: 'monthly', day_of_month: 2, recipients: [4], filters: {}, format: 'xlsx' })
  })

  it('shows the server refusal and keeps the form when a recipient may not receive an export', async () => {
    server.use(
      http.get(`${API}/api/insights/exports/`, () => HttpResponse.json(payload({ schedules: [] }))),
      http.get(`${API}/api/insights/exports/files/mine/`, () => HttpResponse.json([])),
      http.post(`${API}/api/insights/exports/`, () => HttpResponse.json({ recipients: 'Kwame Asante may not receive revenue & sales.' }, { status: 400 })),
    )
    wrap(<ScheduledExportsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'New schedule' }))
    const form = await screen.findByRole('form', { name: 'New schedule' })
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'X' } })
    expect(within(form).getByRole('button', { name: 'Save schedule' })).toBeDisabled()
    fireEvent.click(within(form).getByLabelText(/Kwame Asante/))
    fireEvent.click(within(form).getByRole('button', { name: 'Save schedule' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('may not receive')
  })

  it('pauses and resumes a schedule', async () => {
    const calls = []
    server.use(
      http.get(`${API}/api/insights/exports/`, () => HttpResponse.json(payload())),
      http.get(`${API}/api/insights/exports/files/mine/`, () => HttpResponse.json([])),
      http.post(`${API}/api/insights/exports/1/pause/`, () => { calls.push('pause'); return HttpResponse.json(schedule({ status: 'paused' })) }),
      http.post(`${API}/api/insights/exports/2/resume/`, () => { calls.push('resume'); return HttpResponse.json(schedule({ id: 2 })) }),
    )
    wrap(<ScheduledExportsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pause Weekly sales' }))
    fireEvent.click(screen.getByRole('button', { name: 'Resume Statements' }))
    await waitFor(() => expect(calls).toEqual(['pause', 'resume']))
  })

  it('shows files sent to me that are still valid', async () => {
    server.use(
      http.get(`${API}/api/insights/exports/`, () => HttpResponse.json(payload())),
      http.get(`${API}/api/insights/exports/files/mine/`, () => HttpResponse.json([{ id: 3, name: 'Weekly sales', file_name: 'x.xlsx', expires_at: '2026-10-14T07:00:00Z', download_url: '/api/insights/exports/files/3/download/?sig=abc' }])),
    )
    wrap(<ScheduledExportsPanel />)
    expect(await screen.findByText('Files sent to you')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
  })
})
