import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import TasksPanel from '../TasksPanel.jsx'

const task = (id, title, due) => ({ id, title, notes: '', due_at: due, status: 'open', done_at: null, source_type: '', source_id: '', created_at: due })

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><TasksPanel /></QueryClientProvider>)
}

describe('TasksPanel', () => {
  it('lists open tasks and marks one done', async () => {
    let done = null
    server.use(
      http.get('http://localhost:8000/api/tasks/', () => HttpResponse.json([task(1, 'Call Adwoa Fabrics', '2026-10-07T09:00:00Z')])),
      http.post('http://localhost:8000/api/tasks/1/done/', () => { done = 1; return HttpResponse.json({}) }),
    )
    renderPanel()
    expect(await screen.findByText('Call Adwoa Fabrics')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mark "Call Adwoa Fabrics" done' }))
    await waitFor(() => expect(done).toBe(1))
  })

  it('adds a task', async () => {
    let body = null
    server.use(http.post('http://localhost:8000/api/tasks/', async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 9 }, { status: 201 }) }))
    renderPanel()
    fireEvent.change(await screen.findByLabelText('New task'), { target: { value: 'Resend claim link' } })
    fireEvent.change(screen.getByLabelText('Due'), { target: { value: '2026-10-09T10:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
    await waitFor(() => expect(body?.title).toBe('Resend claim link'))
    expect(body.due_at).toMatch(/^2026-10-09T/)
  })

  it('shows the server detail when an action is refused', async () => {
    server.use(
      http.get('http://localhost:8000/api/tasks/', () => HttpResponse.json([task(1, 'Call Adwoa Fabrics', '2026-10-07T09:00:00Z')])),
      http.post('http://localhost:8000/api/tasks/1/done/', () => HttpResponse.json({ detail: 'That task is not yours.' }, { status: 403 })),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Mark "Call Adwoa Fabrics" done' }))
    expect(await screen.findByText('That task is not yours.')).toBeInTheDocument()
  })

  it('shows an honest empty state', async () => {
    renderPanel()
    expect(await screen.findByText('Nothing here.')).toBeInTheDocument()
  })

  it('offers no team view to someone who leads nobody', async () => {
    renderPanel()
    await screen.findByText('Nothing here.')
    expect(screen.queryByRole('button', { name: "My team's" })).not.toBeInTheDocument()
    expect(screen.queryByText("Your team's overdue follow-ups")).not.toBeInTheDocument()
  })

  it("lets a lead see the team's tasks, who is overdue, and give a task to a report", async () => {
    const urls = []
    let body = null
    server.use(
      http.get('http://localhost:8000/api/tasks/', ({ request }) => {
        urls.push(request.url)
        return HttpResponse.json(request.url.includes('scope=team')
          ? [{ ...task(5, 'Spot-check calls', '2026-10-06T09:00:00Z'), owner: { id: 3, name: 'Yaw Owusu' } }]
          : [])
      }),
      http.get('http://localhost:8000/api/tasks/team-summary/', () => HttpResponse.json([
        { id: 3, name: 'Yaw Owusu', role: 'scout', overdue: 3, oldest_days: 4, state: 'working' },
        { id: 4, name: 'Kofi Boadu', role: 'scout', overdue: 0, oldest_days: null, state: 'leave' },
      ])),
      http.post('http://localhost:8000/api/tasks/', async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 9 }, { status: 201 }) }),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><TasksPanel auth={{ hasPermission: (c) => c === 'staff.invite_team' }} /></QueryClientProvider>)
    expect(await screen.findByText(/oldest 4 days/)).toBeInTheDocument()
    expect(screen.getByText(/on leave/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: "My team's" }))
    expect(await screen.findByText('Spot-check calls')).toBeInTheDocument()
    expect(screen.getByText(/Yaw Owusu/, { selector: 'div' })).toBeInTheDocument()
    expect(urls.some((u) => u.includes('scope=team'))).toBe(true)
    fireEvent.change(screen.getByLabelText('New task'), { target: { value: 'Call Adwoa' } })
    fireEvent.change(screen.getByLabelText('Due'), { target: { value: '2026-10-09T10:00' } })
    fireEvent.change(screen.getByLabelText('For'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
    await waitFor(() => expect(body).toMatchObject({ title: 'Call Adwoa', owner: 3 }))
  })

  it('groups open tasks into overdue, due today and coming up', async () => {
    const soon = new Date(); soon.setHours(23, 59, 0, 0)
    const later = new Date(Date.now() + 3 * 86400e3)
    server.use(http.get('http://localhost:8000/api/tasks/', () => HttpResponse.json([
      task(1, 'Late one', '2026-10-01T09:00:00Z'), task(2, 'Tonight', soon.toISOString()), task(3, 'Next week', later.toISOString()),
    ])))
    renderPanel()
    await screen.findByText('Late one')
    for (const name of ['Overdue', 'Due today', 'Coming up']) expect(screen.getByRole('region', { name })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Overdue' })).getByText('Late one')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Coming up' })).getByText('Next week')).toBeInTheDocument()
  })
})
