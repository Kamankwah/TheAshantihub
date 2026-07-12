import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useCustomers } from '../useCustomers.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useCustomers', () => {
  it('returns the paginated customers response', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/', () => {
        return HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 1, full_name: 'Ama Owusu' }] })
      }),
    )
    const { result } = renderWithClient(() => useCustomers())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.count).toBe(1)
    expect(result.current.data.results).toHaveLength(1)
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/', () => new HttpResponse(null, { status: 403 })),
    )
    const { result } = renderWithClient(() => useCustomers())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
