import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('shows an honest empty state', async () => {
    renderPanel()
    expect(await screen.findByText('Nothing here.')).toBeInTheDocument()
  })
})
