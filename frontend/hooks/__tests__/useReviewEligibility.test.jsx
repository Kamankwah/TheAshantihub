import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useReviewEligibility } from '../useReviewEligibility.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useReviewEligibility', () => {
  it('returns eligible/already_reviewed for a signed-in customer', async () => {
    server.use(
      http.get('http://localhost:8000/api/reviews/eligibility/', ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.get('target_type')).toBe('listing')
        expect(url.searchParams.get('target_id')).toBe('1')
        return HttpResponse.json({ eligible: true, already_reviewed: false })
      }),
    )
    const { result } = renderWithClient(() => useReviewEligibility({ targetType: 'listing', targetId: 1 }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toEqual({ eligible: true, already_reviewed: false })
  })

  it('includes organizer_kind in the query string when provided', async () => {
    server.use(
      http.get('http://localhost:8000/api/reviews/eligibility/', ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.get('organizer_kind')).toBe('business')
        return HttpResponse.json({ eligible: false, already_reviewed: true })
      }),
    )
    const { result } = renderWithClient(() => useReviewEligibility({ targetType: 'organizer', targetId: 2, organizerKind: 'business' }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.already_reviewed).toBe(true)
  })

  it('exposes isError on failure (e.g. a signed-out user gets a 401)', async () => {
    server.use(
      http.get('http://localhost:8000/api/reviews/eligibility/', () => new HttpResponse(null, { status: 401 })),
    )
    const { result } = renderWithClient(() => useReviewEligibility({ targetType: 'listing', targetId: 1 }))
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('is disabled when targetType or targetId is null', () => {
    const { result } = renderWithClient(() => useReviewEligibility({ targetType: null, targetId: null }))
    expect(result.current.fetchStatus).toBe('idle')
  })
})
