import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useMyConversations } from '../useMyConversations.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useMyConversations', () => {
  it('returns a plain (unpaginated) array of the caller\'s own conversations', async () => {
    server.use(
      http.get('http://localhost:8000/api/messaging/conversations/', () => {
        return HttpResponse.json([
          { id: 1, customer: 1, business_owner: null, starter_name: 'Ama', subject: '', status: 'open', messages: [], created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' },
        ])
      }),
    )
    const { result } = renderWithClient(() => useMyConversations())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(Array.isArray(result.current.data)).toBe(true)
    expect(result.current.data).toHaveLength(1)
  })

  it('does not fire when enabled is false', async () => {
    let called = false
    server.use(
      http.get('http://localhost:8000/api/messaging/conversations/', () => {
        called = true
        return HttpResponse.json([])
      }),
    )
    const { result } = renderWithClient(() => useMyConversations(false))
    await new Promise((r) => setTimeout(r, 10))
    expect(called).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/messaging/conversations/', () => new HttpResponse(null, { status: 401 })),
    )
    const { result } = renderWithClient(() => useMyConversations())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
