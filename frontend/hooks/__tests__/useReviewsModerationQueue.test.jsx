import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useReviewsModerationQueue } from '../useReviewsModerationQueue.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useReviewsModerationQueue', () => {
  it('returns the paginated review queue (data.results, not data directly)', async () => {
    server.use(
      http.get('http://localhost:8000/api/reviews/moderation/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 1, target_type: 'listing', rating: 5, comment: 'Great!', verified: true, status: 'published', author_name: 'Ama', created_at: '2026-07-01T00:00:00Z' }],
        })
      }),
    )
    const { result } = renderWithClient(() => useReviewsModerationQueue())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.count).toBe(1)
    expect(result.current.data.results[0].rating).toBe(5)
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/reviews/moderation/', () => new HttpResponse(null, { status: 403 })),
    )
    const { result } = renderWithClient(() => useReviewsModerationQueue())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
