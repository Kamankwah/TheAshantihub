import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useStaffMessagingQueue } from '../useStaffMessagingQueue.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useStaffMessagingQueue', () => {
  it('returns the paginated conversation queue (data.results, not data directly)', async () => {
    server.use(
      http.get('http://localhost:8000/api/messaging/staff/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 1, customer: 1, business_owner: null, starter_name: 'Ama', subject: 'Hi', status: 'open', needs_reply: true, last_message_at: '2026-07-01T00:00:00Z', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' }],
        })
      }),
    )
    const { result } = renderWithClient(() => useStaffMessagingQueue())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.count).toBe(1)
    expect(result.current.data.results[0].needs_reply).toBe(true)
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/messaging/staff/', () => new HttpResponse(null, { status: 403 })),
    )
    const { result } = renderWithClient(() => useStaffMessagingQueue())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
