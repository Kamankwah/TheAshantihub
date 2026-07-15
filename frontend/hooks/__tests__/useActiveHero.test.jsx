import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useActiveHero } from '../useActiveHero.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useActiveHero', () => {
  it('returns the active hero submissions as a plain array', async () => {
    server.use(
      http.get('http://localhost:8000/api/hero/active/', () => {
        return HttpResponse.json([{ id: 1, caption: 'Best lodge in town', business_name: 'Ama Trader' }])
      }),
    )
    const { result } = renderWithClient(() => useActiveHero())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toHaveLength(1)
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/hero/active/', () => new HttpResponse(null, { status: 500 })),
    )
    const { result } = renderWithClient(() => useActiveHero())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
