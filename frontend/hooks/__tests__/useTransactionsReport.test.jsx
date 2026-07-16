import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useTransactionsReport } from '../useTransactionsReport.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useTransactionsReport', () => {
  it('returns the aggregate report', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/transactions/report/', () => {
        return HttpResponse.json({
          summary: { count: 4, total_amount: '620.00' },
          status_breakdown: { success: { count: 3, amount: '600.00' }, refunded: { count: 1, amount: '20.00' } },
          series: [{ month: '2026-06', amount: '300.00' }, { month: '2026-07', amount: '320.00' }],
        })
      }),
    )
    const { result } = renderWithClient(() => useTransactionsReport())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.summary.count).toBe(4)
    expect(result.current.data.series).toHaveLength(2)
  })

  it('forwards date_from/date_to as query params when present', async () => {
    let capturedUrl = null
    server.use(
      http.get('http://localhost:8000/api/billing/transactions/report/', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({ summary: { count: 0, total_amount: '0.00' }, status_breakdown: {}, series: [] })
      }),
    )
    const { result } = renderWithClient(() => useTransactionsReport({ dateFrom: '2026-01-01', dateTo: '2026-01-31' }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(capturedUrl).toContain('date_from=2026-01-01')
    expect(capturedUrl).toContain('date_to=2026-01-31')
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/transactions/report/', () => new HttpResponse(null, { status: 403 })),
    )
    const { result } = renderWithClient(() => useTransactionsReport())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
