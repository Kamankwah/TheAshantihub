import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ReportsPanel from '../ReportsPanel.jsx'

const sections = [
  { key: 'activity', title: 'Activity', rows: [{ label: 'Actions recorded', value: 4 }, { label: 'kyc-approve', value: 2 }] },
  { key: 'calls', title: 'Calls', rows: [{ label: 'Calls logged', value: 3 }] },
]
const report = (overrides = {}) => ({
  id: null, staff: { id: 3, full_name: 'Kwame Asante', role: 'scout' }, period: 'day', period_start: '2026-10-07',
  period_end: '2026-10-07', status: 'draft', submitted_at: null, is_late: false, due_at: '2026-10-07T19:00:00Z',
  achievements: '', blockers: '', plan_next: [], plan_results: [{ item: 'Visit Ejisu', result: '' }], linked_targets: [],
  reviewer: null, reviewed_at: null, review_note: '', similarity: 0, similar_warning: false, can_edit: true,
  can_review: false, system_is_live: true, system: sections, ...overrides,
})
const auth = { user: { id: 3, role: 'scout' }, hasPermission: () => false }

function renderPanel(authProp = auth) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><ReportsPanel auth={authProp} /></QueryClientProvider>)
}
const current = (body) => http.get('http://localhost:8000/api/reports/current/', () => HttpResponse.json(body))

describe('ReportsPanel', () => {
  it("shows the locked system numbers and the previous plan to mark", async () => {
    server.use(current(report()))
    renderPanel()
    expect(await screen.findByText('Calls logged')).toBeInTheDocument()
    expect(screen.getByText('kyc approve')).toBeInTheDocument()
    expect(screen.getByLabelText('Result for "Visit Ejisu"')).toBeInTheDocument()
  })

  it('saves the draft, then submits it', async () => {
    const calls = []
    server.use(
      current(report()),
      http.post('http://localhost:8000/api/reports/', async ({ request }) => { calls.push(await request.json()); return HttpResponse.json(report({ id: 12 })) }),
      http.post('http://localhost:8000/api/reports/12/submit/', () => { calls.push('submit'); return HttpResponse.json(report({ id: 12, status: 'submitted', can_edit: false })) }),
    )
    renderPanel()
    fireEvent.change(await screen.findByLabelText('What went well'), { target: { value: 'Registered Kejetia Beads' } })
    fireEvent.change(screen.getByLabelText('Plan line 1'), { target: { value: 'Visit Bonwire' } })
    fireEvent.change(screen.getByLabelText('Result for "Visit Ejisu"'), { target: { value: 'partly' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[0]).toMatchObject({
      period: 'day', date: '2026-10-07', achievements: 'Registered Kejetia Beads',
      plan_next: ['Visit Bonwire'], plan_results: [{ item: 'Visit Ejisu', result: 'partly' }],
    })
    expect(calls[1]).toBe('submit')
  })

  it('warns when the narrative reads like an earlier report', async () => {
    server.use(current(report({ id: 12, achievements: 'Same as always', similar_warning: true, similarity: 0.91 })))
    renderPanel()
    expect(await screen.findByText(/reads a lot like one of your last five reports/)).toBeInTheDocument()
  })

  it('locks a submitted report', async () => {
    server.use(current(report({ id: 12, status: 'submitted', can_edit: false, achievements: 'Done', system_is_live: false })))
    renderPanel()
    expect(await screen.findByLabelText('What went well')).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument()
  })

  it('shows a returned report with the reviewer note, editable again', async () => {
    server.use(current(report({ id: 12, status: 'returned', review_note: 'Which weavers?', reviewer: { id: 2, full_name: 'Ama Boateng', role: 'operations' } })))
    renderPanel()
    expect(await screen.findByText(/Which weavers\?/)).toBeInTheDocument()
    expect(screen.getByLabelText('What went well')).not.toHaveAttribute('readonly')
  })

  it('queues a long export and says it will appear below', async () => {
    let url = ''
    server.use(http.get('http://localhost:8000/api/reports/export/', ({ request }) => {
      url = request.url
      return HttpResponse.json({ id: 4, status: 'queued' }, { status: 202 })
    }))
    renderPanel()
    fireEvent.change(await screen.findByLabelText('From'), { target: { value: '2026-08-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-07' } })
    fireEvent.click(screen.getByRole('button', { name: 'Export reports' }))
    expect(await screen.findByText("We're preparing that file. It appears below when it's ready.")).toBeInTheDocument()
    expect(url).toContain('from=2026-08-01')
    expect(url).toContain('staff=3')
  })

  it('refreshes the counts and badges after a submit, even a refused one', async () => {
    server.use(
      current(report({ id: 12 })),
      http.post('http://localhost:8000/api/reports/12/submit/', () => HttpResponse.json({ detail: 'Already submitted.' }, { status: 409 })),
      http.post('http://localhost:8000/api/reports/', () => HttpResponse.json(report({ id: 12 }))),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    render(<QueryClientProvider client={queryClient}><ReportsPanel auth={auth} /></QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('Already submitted.')).toBeInTheDocument()
    const keys = spy.mock.calls.map((c) => c[0].queryKey[0])
    for (const key of ['my-reports', 'report', 'team-reports', 'staff-badges', 'notifications']) expect(keys).toContain(key)
  })

  it('shows an expired export download as expired', async () => {
    server.use(
      http.get('http://localhost:8000/api/reports/exports/', () => HttpResponse.json([{ id: 4, file_name: 'r.xlsx', status: 'ready', row_count: 3, error: '', download_url: '/api/reports/exports/4/download/?sig=x' }])),
      http.get('http://localhost:8000/api/reports/exports/4/download/', () => HttpResponse.json({ detail: 'gone' }, { status: 410 })),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }))
    expect(await screen.findByText('That file has expired. Export it again.')).toBeInTheDocument()
  })

  it('shows the server message when an export needs a password', async () => {
    server.use(http.get('http://localhost:8000/api/reports/export/', () => HttpResponse.json({ detail: 'Re-enter your password to continue.', code: 'sudo_required' }, { status: 403 })))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Export reports' }))
    expect(await screen.findByText('Re-enter your password to continue.')).toBeInTheDocument()
  })

  it('shows a draft chip and no report-level export for an unsaved report', async () => {
    renderPanel()
    expect(await screen.findByText('Draft')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Export' })).not.toBeInTheDocument()
  })

  it('does not send a range export with an empty date', async () => {
    let hit = false
    server.use(http.get('http://localhost:8000/api/reports/export/', () => { hit = true; return HttpResponse.json({}) }))
    renderPanel()
    fireEvent.change(await screen.findByLabelText('From'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Export reports' }))
    expect(await screen.findByText('Choose a start and an end date.')).toBeInTheDocument()
    expect(hit).toBe(false)
  })

  it('does not send a range export that starts after it ends', async () => {
    let hit = false
    server.use(http.get('http://localhost:8000/api/reports/export/', () => { hit = true; return HttpResponse.json({}) }))
    renderPanel()
    fireEvent.change(await screen.findByLabelText('From'), { target: { value: '2026-10-07' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Export reports' }))
    expect(await screen.findByText('Choose a start date on or before the end date.')).toBeInTheDocument()
    expect(hit).toBe(false)
  })

  it('says a per-report export was queued and refreshes the exports list', async () => {
    server.use(
      current(report({ id: 12 })),
      http.get('http://localhost:8000/api/reports/12/export/', () => HttpResponse.json({ id: 9, status: 'queued' }, { status: 202 })),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Excel' }))
    expect(await screen.findByText("We're preparing that file. It appears in your exports list when it's ready.")).toBeInTheDocument()
  })

  it('saves the draft alone with the narrative', async () => {
    let saved = null
    server.use(
      current(report()),
      http.post('http://localhost:8000/api/reports/', async ({ request }) => { saved = await request.json(); return HttpResponse.json(report({ id: 12 })) }),
    )
    renderPanel()
    fireEvent.change(await screen.findByLabelText('What got in the way'), { target: { value: 'Rain' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('Draft saved.')).toBeInTheDocument()
    expect(saved).toMatchObject({ blockers: 'Rain' })
  })

  it('offers the team checkbox only with a team permission', async () => {
    renderPanel()
    await screen.findByLabelText('From')
    expect(screen.queryByLabelText("Include my team's reports")).not.toBeInTheDocument()
  })

  it("says everyone's reports to a viewer who can see everyone's", async () => {
    renderPanel({ user: { id: 1 }, hasPermission: (c) => c === 'reports.view_all' || c === 'staff.invite_team' })
    expect(await screen.findByLabelText("Include everyone's reports")).toBeInTheDocument()
    expect(screen.queryByLabelText("Include my team's reports")).not.toBeInTheDocument()
  })

  it('exports the whole team when the checkbox is ticked, otherwise only me', async () => {
    const urls = []
    server.use(http.get('http://localhost:8000/api/reports/export/', ({ request }) => { urls.push(request.url); return HttpResponse.json({ id: 1, status: 'queued' }, { status: 202 }) }))
    renderPanel({ user: { id: 3 }, hasPermission: (c) => c === 'staff.invite_team' })
    fireEvent.click(await screen.findByLabelText("Include my team's reports"))
    fireEvent.click(screen.getByRole('button', { name: 'Export reports' }))
    await waitFor(() => expect(urls).toHaveLength(1))
    expect(urls[0]).not.toContain('staff=')
  })
})
