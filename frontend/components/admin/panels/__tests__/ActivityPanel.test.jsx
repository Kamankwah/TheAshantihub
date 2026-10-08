import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ActivityPanel from '../ActivityPanel.jsx'

const event = (id, actor, role, verb) => ({ id, occurred_at: '2026-10-07T11:40:00Z', actor_type: 'staff', actor_id: id, actor_role: role, actor_label: actor, verb, method: 'POST', target_type: '', target_id: '', target_label: '', summary: '', before: null, after: null })

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><ActivityPanel /></QueryClientProvider>)
}

describe('ActivityPanel', () => {
  it('shows who did what, humanising the verb', async () => {
    server.use(http.get('http://localhost:8000/api/activity/', () => HttpResponse.json({ count: 1, next: null, previous: null, results: [event(1, 'Efua Mensah', 'scout', 'scout.checked_in')] })))
    renderPanel()
    expect(await screen.findByText('Efua Mensah')).toBeInTheDocument()
    expect(screen.getByText('scout checked in')).toBeInTheDocument()
  })

  it('asks the server for only my activity', async () => {
    let lastUrl = ''
    server.use(http.get('http://localhost:8000/api/activity/', ({ request }) => { lastUrl = request.url; return HttpResponse.json({ count: 0, next: null, previous: null, results: [] }) }))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Only mine' }))
    await waitFor(() => expect(lastUrl).toContain('mine=1'))
  })
})
