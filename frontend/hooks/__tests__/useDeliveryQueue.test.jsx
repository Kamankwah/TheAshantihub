import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useDeliveryQueue } from '../useDeliveryQueue.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useDeliveryQueue', () => {
  it('returns the paginated staff order queue (data.results, not data directly)', async () => {
    server.use(
      http.get('http://localhost:8000/api/orders/staff/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 1, customer: 3, customer_name: 'Ama Boateng', status: 'paid', delivery_status: 'processing', total_amount: '150.00', placed_at: '2026-07-01T00:00:00Z', items: [] }],
        })
      }),
    )
    const { result } = renderWithClient(() => useDeliveryQueue())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.count).toBe(1)
    expect(result.current.data.results[0].customer_name).toBe('Ama Boateng')
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/orders/staff/', () => new HttpResponse(null, { status: 403 })),
    )
    const { result } = renderWithClient(() => useDeliveryQueue())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
