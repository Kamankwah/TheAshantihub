import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useMyHeroSubmission } from '../useMyHeroSubmission.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useMyHeroSubmission', () => {
  it('returns an empty object when the business owner has no submission yet', async () => {
    server.use(
      http.get('http://localhost:8000/api/hero/mine/', () => {
        return HttpResponse.json({})
      }),
    )
    const { result } = renderWithClient(() => useMyHeroSubmission())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toEqual({})
  })

  it('returns the submission when one exists', async () => {
    server.use(
      http.get('http://localhost:8000/api/hero/mine/', () => {
        return HttpResponse.json({ id: 1, caption: 'Best lodge in town', status: 'pending' })
      }),
    )
    const { result } = renderWithClient(() => useMyHeroSubmission())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.status).toBe('pending')
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/hero/mine/', () => new HttpResponse(null, { status: 401 })),
    )
    const { result } = renderWithClient(() => useMyHeroSubmission())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
