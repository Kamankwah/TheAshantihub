import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useRelatedListings } from '../useRelatedListings.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useRelatedListings', () => {
  it('returns the related listings array on success', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/1/related/', () => {
        return HttpResponse.json([{ id: 2, name: 'Adum Guest House' }])
      }),
    )
    const { result } = renderWithClient(() => useRelatedListings(1))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data[0].name).toBe('Adum Guest House')
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/999/related/', () => new HttpResponse(null, { status: 404 })),
    )
    const { result } = renderWithClient(() => useRelatedListings(999))
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('is disabled when id is null', () => {
    const { result } = renderWithClient(() => useRelatedListings(null))
    expect(result.current.fetchStatus).toBe('idle')
  })
})
