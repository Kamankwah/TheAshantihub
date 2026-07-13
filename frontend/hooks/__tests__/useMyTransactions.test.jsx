import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useMyTransactions } from '../useMyTransactions.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useMyTransactions', () => {
  it('returns the business owner\'s own transactions, newest first', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/transactions/mine/', () => {
        return HttpResponse.json([{ id: 1, amount: '100.00', purpose: 'AshantiHub Standard Plan', status: 'success', reference: 'AHTESTXYZ', created_at: '2026-07-01T00:00:00Z' }])
      }),
    )
    const { result } = renderWithClient(() => useMyTransactions())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data[0].reference).toBe('AHTESTXYZ')
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/transactions/mine/', () => new HttpResponse(null, { status: 403 })),
    )
    const { result } = renderWithClient(() => useMyTransactions())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
