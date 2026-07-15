import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useOrganizerReviews } from '../useOrganizerReviews.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useOrganizerReviews', () => {
  it('returns the paginated organizer review list with top-level avg_rating/review_count', async () => {
    server.use(
      http.get('http://localhost:8000/api/reviews/organizer/business/1/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 1, target_type: 'organizer', rating: 4, comment: 'Well run event', verified: true, author_name: 'Kofi', created_at: '2026-07-01T00:00:00Z' }],
          avg_rating: 4, review_count: 1,
        })
      }),
    )
    const { result } = renderWithClient(() => useOrganizerReviews('business', 1))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.results).toHaveLength(1)
    expect(result.current.data.avg_rating).toBe(4)
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/reviews/organizer/customer/999/', () => new HttpResponse(null, { status: 404 })),
    )
    const { result } = renderWithClient(() => useOrganizerReviews('customer', 999))
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('is disabled when kind is null', () => {
    const { result } = renderWithClient(() => useOrganizerReviews(null, 1))
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('is disabled when id is null', () => {
    const { result } = renderWithClient(() => useOrganizerReviews('business', null))
    expect(result.current.fetchStatus).toBe('idle')
  })
})
