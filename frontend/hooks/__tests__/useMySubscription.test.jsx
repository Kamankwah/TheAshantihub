import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useMySubscription } from '../useMySubscription.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useMySubscription', () => {
  it('returns an empty object when the business owner has no subscription yet', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/subscriptions/me/', () => {
        return HttpResponse.json({})
      }),
    )
    const { result } = renderWithClient(() => useMySubscription())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toEqual({})
  })

  it('returns the subscription when one exists', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/subscriptions/me/', () => {
        return HttpResponse.json({ id: 1, plan: { tier: 'standard', name: 'Standard' }, billing_cycle: 'monthly', status: 'active' })
      }),
    )
    const { result } = renderWithClient(() => useMySubscription())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.status).toBe('active')
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/subscriptions/me/', () => new HttpResponse(null, { status: 403 })),
    )
    const { result } = renderWithClient(() => useMySubscription())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
