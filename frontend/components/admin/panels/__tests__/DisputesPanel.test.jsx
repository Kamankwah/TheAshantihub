import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import DisputesPanel from '../DisputesPanel.jsx'

const DISPUTE = {
  id: 9, order: 41, reason: 'not_received', description: 'Never arrived', status: 'open',
  raised_by_name: 'Ama', created_at: '2026-09-01T00:00:00Z',
}
const auth = { hasPermission: (c) => c === 'disputes.resolve_financial' }

function setup() {
  const resolveBodies = []
  server.use(
    http.get('http://localhost:8000/api/disputes/', ({ request }) => {
      const status = new URL(request.url).searchParams.get('status')
      return HttpResponse.json({ count: 1, next: null, previous: null, results: status === 'pending' ? [DISPUTE] : [] })
    }),
    http.post('http://localhost:8000/api/disputes/:id/resolve/', async ({ request }) => {
      resolveBodies.push(await request.json())
      return HttpResponse.json({ id: 9, status: 'rejected' })
    }),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><DisputesPanel auth={auth} /></QueryClientProvider>)
  return resolveBodies
}

describe('DisputesPanel Reject confirmation', () => {
  it('does not send the reject request until confirmed, then sends exactly one', async () => {
    const bodies = setup()
    fireEvent.click(await screen.findByText('✕ Reject'))
    expect(screen.getByText(/Reject this dispute\?/)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(bodies).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Confirm reject' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ outcome: 'rejected' })
  })

  it('Keep sends nothing and restores the Reject button', async () => {
    const bodies = setup()
    fireEvent.click(await screen.findByText('✕ Reject'))
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    await new Promise((r) => setTimeout(r, 50))
    expect(bodies).toHaveLength(0)
    expect(screen.getByText('✕ Reject')).toBeInTheDocument()
    expect(screen.queryByText(/Reject this dispute\?/)).not.toBeInTheDocument()
  })
})
