import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useListingReviews } from '../useListingReviews.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useListingReviews', () => {
  it('returns the paginated review list with top-level avg_rating/review_count', async () => {
    server.use(
      http.get('http://localhost:8000/api/reviews/listing/1/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 1, target_type: 'listing', rating: 5, comment: 'Great!', verified: true, author_name: 'Ama', created_at: '2026-07-01T00:00:00Z' }],
          avg_rating: 5, review_count: 1,
        })
      }),
    )
    const { result } = renderWithClient(() => useListingReviews(1))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.results).toHaveLength(1)
    expect(result.current.data.avg_rating).toBe(5)
    expect(result.current.data.review_count).toBe(1)
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/reviews/listing/999/', () => new HttpResponse(null, { status: 404 })),
    )
    const { result } = renderWithClient(() => useListingReviews(999))
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('is disabled when id is null', () => {
    const { result } = renderWithClient(() => useListingReviews(null))
    expect(result.current.fetchStatus).toBe('idle')
  })
})
