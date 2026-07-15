import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useContactMessagesQueue } from '../useContactMessagesQueue.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useContactMessagesQueue', () => {
  it('returns the paginated contact-messages queue (data.results, not data directly)', async () => {
    server.use(
      http.get('http://localhost:8000/api/core/contact-messages/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 1, category: 'general', name: 'Ama', email: 'ama@example.com', phone: '', subject: 'Hi', message: 'Hello', status: 'new', resolved_by_name: null, resolved_at: null, created_at: '2026-07-01T00:00:00Z' }],
        })
      }),
    )
    const { result } = renderWithClient(() => useContactMessagesQueue())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.count).toBe(1)
    expect(result.current.data.results[0].subject).toBe('Hi')
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/core/contact-messages/', () => new HttpResponse(null, { status: 403 })),
    )
    const { result } = renderWithClient(() => useContactMessagesQueue())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
