import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useStaffRoster } from '../useStaffRoster.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useStaffRoster', () => {
  it('returns the paginated staff roster response', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/', () => {
        return HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 1, full_name: 'Akosua Support', role: 'support', status: 'active' }] })
      }),
    )
    const { result } = renderWithClient(() => useStaffRoster())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.results[0].status).toBe('active')
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/', () => new HttpResponse(null, { status: 403 })),
    )
    const { result } = renderWithClient(() => useStaffRoster())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
