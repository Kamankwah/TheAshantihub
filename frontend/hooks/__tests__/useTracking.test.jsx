import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useDispatchMap, useJobMap, useOrderTracking, useOwnerOrderTracking, useQueueMap } from '../useTracking.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const out = renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
  return { ...out, queryClient }
}

const CASES = [
  ['useQueueMap', (id) => useQueueMap(id), 'track-queue', 'queue map', (d) => d.riders.length, 2],
  ['useJobMap', (id) => useJobMap(id), 'track-job', 'job map', (d) => d.leg.basis, 'road route'],
  ['useDispatchMap', (id) => useDispatchMap(id), 'track-dispatch', 'dispatch map', (d) => d.stage, 'picked_up'],
  ['useOrderTracking', (id) => useOrderTracking(id), 'track-order', 'order tracking', (d) => d.drop.lat, 5.6],
  ['useOwnerOrderTracking', (id) => useOwnerOrderTracking(id), 'track-owner-order', 'owner tracking', (d) => d.pickup.name, 'Akosua Ntoma'],
]

describe('tracking hooks', () => {
  it.each(CASES)('%s reads the default payload', async (_n, hook, key, _l, pick, expected) => {
    const { result, queryClient } = renderWithClient(() => hook(7))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(pick(result.current.data)).toBe(expected)
    expect(queryClient.getQueryCache().getAll()[0].queryKey[0]).toBe(key)
  })

  it('requests the right URL for each endpoint', async () => {
    const seen = []
    server.events.on('request:start', ({ request }) => seen.push(new URL(request.url).pathname))
    for (const [, hook] of CASES) {
      const { result } = renderWithClient(() => hook(7))
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
    }
    server.events.removeAllListeners()
    expect(seen).toEqual(expect.arrayContaining([
      '/api/delivery/queue/7/map/', '/api/delivery/jobs/7/map/', '/api/orders/dispatch/7/map/',
      '/api/orders/7/tracking/', '/api/orders/owner/7/tracking/',
    ]))
  })

  it('polls every 15 s, only while the tab is visible', async () => {
    const { result, queryClient } = renderWithClient(() => useJobMap(7))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const opts = queryClient.getQueryCache().getAll()[0].options
    expect(opts.refetchInterval).toBe(15000)
    expect(opts.refetchIntervalInBackground).toBe(false)
  })

  it('does not fetch when disabled', async () => {
    const { result } = renderWithClient(() => useOrderTracking(7, { enabled: false }))
    expect(result.current.fetchStatus).toBe('idle')
    const owner = renderWithClient(() => useOwnerOrderTracking(7, { enabled: false }))
    expect(owner.result.current.fetchStatus).toBe('idle')
  })

  it('exposes isError on failure', async () => {
    server.use(http.get('http://localhost:8000/api/delivery/jobs/:id/map/', () => new HttpResponse(null, { status: 404 })))
    const { result } = renderWithClient(() => useJobMap(7))
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
