import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useCategories } from '../useCategories.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useCategories', () => {
  it('returns the categories list on success', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/categories/', () => {
        return HttpResponse.json([
          { id: 1, slug: 'hotels', icon: '🏨', label: 'Hotels', color: '#000080' },
          { id: 2, slug: 'food', icon: '🍲', label: 'Food', color: '#CC0000' },
        ])
      }),
    )
    const { result } = renderWithClient(() => useCategories())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toHaveLength(2)
    expect(result.current.data[0].slug).toBe('hotels')
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/categories/', () => {
        return new HttpResponse(null, { status: 500 })
      }),
    )
    const { result } = renderWithClient(() => useCategories())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
