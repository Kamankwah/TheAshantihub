import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useStaffBadges } from '../useStaffBadges.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useStaffBadges', () => {
  it('returns per-tab pending counts', async () => {
    server.use(
      http.get('http://localhost:8000/api/notifications/staff-badges/', () => {
        return HttpResponse.json({
          kyc: 3, listings: 1, events: 0, hero: 2, reviews: 0,
          plan_approvals: 0, contact_messages: 5, escrow: 0,
        })
      }),
    )
    const { result } = renderWithClient(() => useStaffBadges())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.kyc).toBe(3)
    expect(result.current.data.contact_messages).toBe(5)
  })

  it('does not fetch when disabled (non-staff caller)', async () => {
    const { result } = renderWithClient(() => useStaffBadges(false))
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
  })
})
