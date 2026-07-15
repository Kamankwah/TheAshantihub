import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useMyEvents } from '../useMyEvents.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useMyEvents', () => {
  it('returns the caller\'s own events as a plain array, including access_code', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/mine/', () =>
        HttpResponse.json([{ id: 1, name: 'Akwasidae Festival', status: 'pending', access_level: 'private', access_code: 'AB12CD' }]),
      ),
    )
    const { result } = renderWithClient(() => useMyEvents())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data[0].access_code).toBe('AB12CD')
  })

  it('exposes isError on failure', async () => {
    server.use(http.get('http://localhost:8000/api/events/mine/', () => new HttpResponse(null, { status: 401 })))
    const { result } = renderWithClient(() => useMyEvents())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
