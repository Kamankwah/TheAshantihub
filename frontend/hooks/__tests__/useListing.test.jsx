import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useListing } from '../useListing.js'

function renderWithClient(hook, options = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: options.retry ?? false,
      },
    },
  })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useListing', () => {
  it('returns the listing detail on success', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => {
        return HttpResponse.json({ id: 1, name: 'Royal Ashanti Lodge' })
      }),
    )
    const { result } = renderWithClient(() => useListing(1))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.name).toBe('Royal Ashanti Lodge')
  })

  it('exposes isError for a 404', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/999/', () => {
        return new HttpResponse(null, { status: 404 })
      }),
    )
    const { result } = renderWithClient(() => useListing(999))
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
