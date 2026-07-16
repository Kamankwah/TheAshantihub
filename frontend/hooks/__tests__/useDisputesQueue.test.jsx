import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useDisputesQueue } from '../useDisputesQueue.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useDisputesQueue', () => {
  it('returns the paginated disputes queue (data.results, not data directly)', async () => {
    server.use(
      http.get('http://localhost:8000/api/disputes/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 1, order: 5, reason: 'delivery_issue', description: 'Never arrived.', status: 'open' }],
        })
      }),
    )
    const { result } = renderWithClient(() => useDisputesQueue())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.count).toBe(1)
    expect(result.current.data.results[0].reason).toBe('delivery_issue')
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/disputes/', () => new HttpResponse(null, { status: 403 })),
    )
    const { result } = renderWithClient(() => useDisputesQueue())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('does not fire when enabled is false', async () => {
    let called = false
    server.use(
      http.get('http://localhost:8000/api/disputes/', () => {
        called = true
        return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
      }),
    )
    const { result } = renderWithClient(() => useDisputesQueue({ enabled: false }))
    await new Promise((r) => setTimeout(r, 10))
    expect(called).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
  })
})
