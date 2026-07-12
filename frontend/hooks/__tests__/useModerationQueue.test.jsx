import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useModerationQueue } from '../useModerationQueue.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useModerationQueue', () => {
  it('returns the pending listings queue as a plain array', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/moderation/pending/', () => {
        return HttpResponse.json([{ id: 1, name: 'Royal Ashanti Lodge', status: 'pending_review' }])
      }),
    )
    const { result } = renderWithClient(() => useModerationQueue())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toHaveLength(1)
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/moderation/pending/', () => new HttpResponse(null, { status: 403 })),
    )
    const { result } = renderWithClient(() => useModerationQueue())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
