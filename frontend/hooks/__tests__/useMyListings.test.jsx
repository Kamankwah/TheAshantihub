import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useMyListings } from '../useMyListings.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useMyListings', () => {
  it('returns the business owner\'s own listings as a plain array', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/mine/', () => {
        return HttpResponse.json([{ id: 1, name: 'Standard Room', status: 'published' }])
      }),
    )
    const { result } = renderWithClient(() => useMyListings())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toHaveLength(1)
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/mine/', () => new HttpResponse(null, { status: 401 })),
    )
    const { result } = renderWithClient(() => useMyListings())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
