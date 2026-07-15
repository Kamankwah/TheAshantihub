import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useEventAttendees } from '../useEventAttendees.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useEventAttendees', () => {
  it('returns the paginated attendee list when enabled', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/1/rsvps/', () =>
        HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [{ customer_name: 'Ama Owusu', customer_phone: '+233241234567', customer_email: 'ama@example.com', status: 'going', rsvp_at: '2026-07-01T00:00:00Z' }],
        }),
      ),
    )
    const { result } = renderWithClient(() => useEventAttendees(1, { enabled: true }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.count).toBe(1)
    expect(result.current.data.results[0].customer_name).toBe('Ama Owusu')
  })

  it('exposes isError on failure (e.g. a non-organizer caller gets a 403)', async () => {
    server.use(http.get('http://localhost:8000/api/events/1/rsvps/', () => new HttpResponse(null, { status: 403 })))
    const { result } = renderWithClient(() => useEventAttendees(1, { enabled: true }))
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('does not fire when enabled is false (default)', () => {
    const { result } = renderWithClient(() => useEventAttendees(1))
    expect(result.current.isLoading).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('does not fire when eventId is null even if enabled is true', () => {
    const { result } = renderWithClient(() => useEventAttendees(null, { enabled: true }))
    expect(result.current.isLoading).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
  })
})
