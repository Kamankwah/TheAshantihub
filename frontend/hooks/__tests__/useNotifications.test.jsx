import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useNotifications } from '../useNotifications.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useNotifications', () => {
  it('returns the { unread_count, results } envelope', async () => {
    server.use(
      http.get('http://localhost:8000/api/notifications/', () => {
        return HttpResponse.json({
          unread_count: 2,
          results: [
            { id: 1, kind: 'order_status', title: 'Order update', body: 'Shipped', link: '/my-account', icon: '🚚', is_read: false, created_at: '2026-07-01T00:00:00Z' },
            { id: 2, kind: 'support_reply', title: 'Support replied', body: '', link: '/my-account', icon: '💬', is_read: true, created_at: '2026-07-01T00:00:00Z' },
          ],
        })
      }),
    )
    const { result } = renderWithClient(() => useNotifications())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.unread_count).toBe(2)
    expect(result.current.data.results).toHaveLength(2)
    expect(result.current.data.results[0].title).toBe('Order update')
  })

  it('does not fetch when disabled', async () => {
    const { result } = renderWithClient(() => useNotifications(false))
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
  })
})
