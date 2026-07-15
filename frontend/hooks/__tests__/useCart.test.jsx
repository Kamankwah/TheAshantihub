import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useCart } from '../useCart.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useCart', () => {
  it('returns the cart with its items and total', async () => {
    server.use(
      http.get('http://localhost:8000/api/cart/', () => {
        return HttpResponse.json({
          id: 1,
          items: [{ id: 1, listing: 5, listing_name: 'Kente Cloth', quantity: 2, unit_price_snapshot: '150.00', line_total: '300.00', added_at: '2026-07-10T00:00:00Z' }],
          total: '300.00',
          created_at: '2026-07-01T00:00:00Z',
          updated_at: '2026-07-10T00:00:00Z',
        })
      }),
    )
    const { result } = renderWithClient(() => useCart())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.items).toHaveLength(1)
    expect(result.current.data.total).toBe('300.00')
  })

  it('does not fire the request when enabled is false', async () => {
    let called = false
    server.use(
      http.get('http://localhost:8000/api/cart/', () => {
        called = true
        return HttpResponse.json({ id: 1, items: [], total: '0.00' })
      }),
    )
    const { result } = renderWithClient(() => useCart(false))
    expect(result.current.fetchStatus).toBe('idle')
    expect(called).toBe(false)
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/cart/', () => new HttpResponse(null, { status: 401 })),
    )
    const { result } = renderWithClient(() => useCart())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
