import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useEvents } from '../useEvents.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient()
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

const PAGE_ONE = {
  count: 25,
  next: 'http://localhost:8000/api/events/?page=2',
  previous: null,
  results: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Event ${i + 1}` })),
}

const PAGE_TWO = {
  count: 25,
  next: null,
  previous: 'http://localhost:8000/api/events/?page=1',
  results: Array.from({ length: 5 }, (_, i) => ({ id: i + 21, name: `Event ${i + 21}` })),
}

describe('useEvents', () => {
  it('fetches the first page and exposes pagination info', async () => {
    server.use(http.get('http://localhost:8000/api/events/', () => HttpResponse.json(PAGE_ONE)))
    const { result } = renderWithClient(() => useEvents({}))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.pages[0].results).toHaveLength(20)
    expect(result.current.hasNextPage).toBe(true)
  })

  it('fetches the next page when fetchNextPage is called', async () => {
    let callCount = 0
    server.use(
      http.get('http://localhost:8000/api/events/', () => {
        callCount += 1
        return HttpResponse.json(callCount === 1 ? PAGE_ONE : PAGE_TWO)
      }),
    )
    const { result } = renderWithClient(() => useEvents({}))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    result.current.fetchNextPage()
    await waitFor(() => expect(result.current.data.pages).toHaveLength(2))
    expect(result.current.data.pages[1].results).toHaveLength(5)
    expect(result.current.hasNextPage).toBe(false)
  })

  it('includes category/zone/search filter params in the request', async () => {
    let capturedUrl
    server.use(
      http.get('http://localhost:8000/api/events/', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json(PAGE_ONE)
      }),
    )
    const { result } = renderWithClient(() => useEvents({ category: 'festivals', zone: 'Adum', search: 'akwasidae' }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const url = new URL(capturedUrl)
    expect(url.searchParams.get('category')).toBe('festivals')
    expect(url.searchParams.get('zone')).toBe('Adum')
    expect(url.searchParams.get('search')).toBe('akwasidae')
  })

  it('defaults filters to an empty object', async () => {
    server.use(http.get('http://localhost:8000/api/events/', () => HttpResponse.json(PAGE_ONE)))
    const { result } = renderWithClient(() => useEvents())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.pages[0].results).toHaveLength(20)
  })

  it('refetches when filters change (different query key)', async () => {
    let requestCount = 0
    server.use(
      http.get('http://localhost:8000/api/events/', () => {
        requestCount += 1
        return HttpResponse.json(PAGE_ONE)
      }),
    )
    const queryClient = new QueryClient()
    const { result, rerender } = renderHook(({ filters }) => useEvents(filters), {
      initialProps: { filters: { category: 'festivals' } },
      wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(requestCount).toBe(1)
    rerender({ filters: { category: 'markets' } })
    await waitFor(() => expect(requestCount).toBe(2))
  })
})
