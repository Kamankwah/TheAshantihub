import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useMyCreditScore } from '../useMyCreditScore.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useMyCreditScore', () => {
  it('returns the compute-on-read credit score for the business owner', async () => {
    server.use(
      http.get('http://localhost:8000/api/credit/scores/me/', () => {
        return HttpResponse.json({
          score: 300, grade: 'D', grade_label: 'Very Poor', loan_eligible: false,
          factors: {
            listings_published: { value: 0, score_pct: 0.0, weight: 0.25 },
            account_tenure_months: { value: 0.1, score_pct: 0.4, weight: 0.2 },
            kyc_verified: { value: false, score_pct: 0.0, weight: 0.3 },
            payout_verified: { value: false, score_pct: 0.0, weight: 0.25 },
          },
          computed_at: '2026-07-12T00:00:00Z',
        })
      }),
    )
    const { result } = renderWithClient(() => useMyCreditScore())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.score).toBe(300)
    expect(result.current.data.loan_eligible).toBe(false)
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/credit/scores/me/', () => new HttpResponse(null, { status: 403 })),
    )
    const { result } = renderWithClient(() => useMyCreditScore())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
