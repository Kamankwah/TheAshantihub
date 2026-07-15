import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useOrders } from '../useOrders.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useOrders', () => {
  it('returns the caller\'s past orders as a plain array', async () => {
    server.use(
      http.get('http://localhost:8000/api/orders/', () => {
        return HttpResponse.json([
          { id: 1, status: 'paid', total_amount: '300.00', placed_at: '2026-07-10T00:00:00Z', items: [] },
        ])
      }),
    )
    const { result } = renderWithClient(() => useOrders())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data[0].status).toBe('paid')
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/orders/', () => new HttpResponse(null, { status: 401 })),
    )
    const { result } = renderWithClient(() => useOrders())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
