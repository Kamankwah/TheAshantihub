import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import { gatedOpening } from '../../../mocks/opening.js'
import { useOpening } from '../../../hooks/useOpening.js'
import { opensLabel, opensHeadline } from '../../../lib/openingFormat.js'

const DAY = 24 * 60 * 60 * 1000

function wrapper({ children }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

afterEach(() => vi.restoreAllMocks())

describe('useOpening', () => {
  it('is open by default (gate switched off)', async () => {
    const { result } = renderHook(() => useOpening(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.isOpen).toBe(true)
  })

  it('ignores_device_clock: remaining time comes from server_now, not Date.now', async () => {
    const serverNow = Date.parse('2026-11-03T06:00:00Z')
    const opensAt = '2026-11-06T06:00:00Z'
    // The device clock runs two days ahead of the server.
    const realNow = Date.now.bind(Date)
    const skew = serverNow + 2 * DAY - realNow()
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew)
    server.use(gatedOpening({ opensAt, serverNow: new Date(serverNow).toISOString() }))

    const { result } = renderHook(() => useOpening(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.isOpen).toBe(false)
    // Three days by the server's clock — a device-clock countdown would say one.
    expect(result.current.remainingMs).toBeGreaterThan(3 * DAY - 5000)
    expect(result.current.remainingMs).toBeLessThanOrEqual(3 * DAY)
    expect(Math.abs(result.current.serverNow() - serverNow)).toBeLessThan(5000)
    expect(result.current.opensAt.toISOString()).toBe('2026-11-06T06:00:00.000Z')
  })

  it('flips_open_at_zero', async () => {
    server.use(gatedOpening({ opensAt: new Date(Date.now() + 1500).toISOString() }))
    const { result } = renderHook(() => useOpening(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.isOpen).toBe(false)
    await waitFor(() => expect(result.current.isOpen).toBe(true), { timeout: 4000 })
    expect(result.current.remainingMs).toBe(0)
  })
})

describe('opening labels (Africa/Accra, never hardcoded)', () => {
  it('formats the default opening as "Opens 6 Nov" and the headline time', () => {
    const at = new Date('2026-11-06T06:00:00Z')
    expect(opensLabel(at)).toBe('Opens 6 Nov')
    expect(opensHeadline(at)).toBe('The marketplace opens 6 Nov, 06:00')
  })

  it('follows a delayed opening time', () => {
    expect(opensLabel(new Date('2026-11-20T09:30:00Z'))).toBe('Opens 20 Nov')
  })
})
