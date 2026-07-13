import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useSubscriptionPlans } from '../useSubscriptionPlans.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useSubscriptionPlans', () => {
  it('returns the list of subscription plans', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/plans/', () => {
        return HttpResponse.json([
          { id: 1, tier: 'basic', name: 'Basic', monthly_price: '20.00', annual_price: '200.00', features: [], is_recommended: false },
        ])
      }),
    )
    const { result } = renderWithClient(() => useSubscriptionPlans())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data[0].tier).toBe('basic')
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/plans/', () => new HttpResponse(null, { status: 500 })),
    )
    const { result } = renderWithClient(() => useSubscriptionPlans())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
