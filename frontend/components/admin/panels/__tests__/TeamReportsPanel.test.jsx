import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import TeamReportsPanel from '../TeamReportsPanel.jsx'

const yaws = {
  id: 21, staff: { id: 5, full_name: 'Yaw Owusu', role: 'scout' }, period: 'day', period_start: '2026-10-06',
  period_end: '2026-10-06', status: 'submitted', submitted_at: '2026-10-06T21:12:00Z', is_late: true,
  due_at: '2026-10-06T19:00:00Z', achievements: 'Visited three weavers in Bonwire', blockers: 'Network was poor',
  plan_next: ['Register Bonwire Kente Looms'], plan_results: [], linked_targets: [], reviewer: null, reviewed_at: null,
  review_note: '', similarity: 0.86, similar_warning: true, can_edit: false, can_review: true, system_is_live: false,
}
const team = (rows) => http.get('http://localhost:8000/api/reports/team/', () => HttpResponse.json({ period: 'day', period_start: '2026-10-06', rows }))

function renderPanel(auth = { hasPermission: () => false }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><TeamReportsPanel auth={auth} /></QueryClientProvider>)
}

describe('TeamReportsPanel', () => {
  it('lists the team with its flags and returns a report with a comment', async () => {
    let returned = null
    server.use(
      team([{ staff: yaws.staff, report: yaws }, { staff: { id: 6, full_name: 'Efua Mensah', role: 'scout' }, report: null }]),
      http.get('http://localhost:8000/api/reports/21/', () => HttpResponse.json({ ...yaws, system: [{ key: 'calls', title: 'Calls', rows: [{ label: 'Calls logged', value: 2 }] }] })),
      http.post('http://localhost:8000/api/reports/21/return/', async ({ request }) => {
        returned = await request.json()
        return HttpResponse.json({ ...yaws, status: 'returned', can_review: false })
      }),
    )
    renderPanel()
    expect(await screen.findByText('Not submitted yet')).toBeInTheDocument()
    expect(screen.getByText('Waiting for you · 1')).toBeInTheDocument()
    expect(screen.getByText('Late')).toBeInTheDocument()
    expect(screen.getByText('Copy check 86%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: "Open Yaw Owusu's report" }))
    expect(await screen.findByText('Visited three weavers in Bonwire')).toBeInTheDocument()
    expect(screen.getByText('Calls logged')).toBeInTheDocument()
    const returnButton = screen.getByRole('button', { name: 'Return with comment' })
    expect(returnButton).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Comment to Yaw Owusu/), { target: { value: 'Which weavers?' } })
    fireEvent.click(returnButton)
    await waitFor(() => expect(returned).toEqual({ note: 'Which weavers?' }))
  })

  it('acknowledges a report', async () => {
    let acknowledged = false
    server.use(
      team([{ staff: yaws.staff, report: yaws }]),
      http.get('http://localhost:8000/api/reports/21/', () => HttpResponse.json({ ...yaws, system: [] })),
      http.post('http://localhost:8000/api/reports/21/acknowledge/', () => { acknowledged = true; return HttpResponse.json({ ...yaws, status: 'acknowledged', can_review: false }) }),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: "Open Yaw Owusu's report" }))
    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }))
    await waitFor(() => expect(acknowledged).toBe(true))
  })

  it("offers everyone's reports to a Super Admin", async () => {
    let lastUrl = ''
    server.use(http.get('http://localhost:8000/api/reports/team/', ({ request }) => {
      lastUrl = request.url
      return HttpResponse.json({ period: 'day', period_start: '2026-10-07', rows: [] })
    }))
    renderPanel({ hasPermission: (c) => c === 'reports.view_all' })
    fireEvent.click(await screen.findByRole('button', { name: 'Everyone' }))
    await waitFor(() => expect(lastUrl).toContain('scope=all'))
    expect(await screen.findByText('Nobody to show for this period.')).toBeInTheDocument()
  })

  it('refreshes after a refused review', async () => {
    let fetched = 0
    server.use(
      http.get('http://localhost:8000/api/reports/team/', () => { fetched += 1; return HttpResponse.json({ period: 'day', period_start: '2026-10-06', rows: [{ staff: yaws.staff, report: yaws }] }) }),
      http.get('http://localhost:8000/api/reports/21/', () => HttpResponse.json({ ...yaws, system: [] })),
      http.post('http://localhost:8000/api/reports/21/acknowledge/', () => HttpResponse.json({ detail: 'Already reviewed.' }, { status: 409 })),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: "Open Yaw Owusu's report" }))
    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }))
    expect(await screen.findByText('Already reviewed.')).toBeInTheDocument()
    await waitFor(() => expect(fetched).toBeGreaterThan(1))
  })

  it('offers no review buttons when the viewer cannot review', async () => {
    server.use(
      team([{ staff: yaws.staff, report: { ...yaws, can_review: false } }]),
      http.get('http://localhost:8000/api/reports/21/', () => HttpResponse.json({ ...yaws, can_review: false, system: [] })),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: "Open Yaw Owusu's report" }))
    await screen.findByText('Visited three weavers in Bonwire')
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Return with comment' })).not.toBeInTheDocument()
  })

  it('hides the Everyone toggle without reports.view_all', async () => {
    server.use(team([]))
    renderPanel()
    await screen.findByText('Nobody to show for this period.')
    expect(screen.queryByRole('button', { name: 'Everyone' })).not.toBeInTheDocument()
  })
})
