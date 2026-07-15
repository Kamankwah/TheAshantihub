import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useOwnerReviews } from '../useOwnerReviews.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useOwnerReviews', () => {
  it('returns the paginated seller review list with top-level avg_rating/review_count', async () => {
    server.use(
      http.get('http://localhost:8000/api/reviews/seller/1/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 1, target_type: 'seller', rating: 5, comment: 'Reliable seller', verified: true, author_name: 'Ama', created_at: '2026-07-01T00:00:00Z' }],
          avg_rating: 5, review_count: 1,
        })
      }),
    )
    const { result } = renderWithClient(() => useOwnerReviews(1))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.results).toHaveLength(1)
    expect(result.current.data.avg_rating).toBe(5)
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/reviews/seller/999/', () => new HttpResponse(null, { status: 404 })),
    )
    const { result } = renderWithClient(() => useOwnerReviews(999))
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('is disabled when businessOwnerId is null', () => {
    const { result } = renderWithClient(() => useOwnerReviews(null))
    expect(result.current.fetchStatus).toBe('idle')
  })
})
