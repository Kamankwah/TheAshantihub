import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useEvent } from '../useEvent.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useEvent', () => {
  it('returns full detail for a public event', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/1/', () =>
        HttpResponse.json({ id: 1, name: 'Akwasidae Festival', description: 'Royal drumming.', address: 'Manhyia Palace' }),
      ),
    )
    const { result } = renderWithClient(() => useEvent(1))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.description).toBe('Royal drumming.')
  })

  it('returns the teaser subset for a locked private event', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/2/', () =>
        HttpResponse.json({ id: 2, name: 'Private Wedding', is_private: true }),
      ),
    )
    const { result } = renderWithClient(() => useEvent(2))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.description).toBeUndefined()
    expect(result.current.data.is_private).toBe(true)
  })

  it('does not fire when id is null', () => {
    const { result } = renderWithClient(() => useEvent(null))
    expect(result.current.isLoading).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
  })
})
