import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useListings } from '../useListings.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient()
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

const PAGE_ONE = {
  count: 25,
  next: 'http://localhost:8000/api/listings/?page=2',
  previous: null,
  results: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Listing ${i + 1}` })),
}

const PAGE_TWO = {
  count: 25,
  next: null,
  previous: 'http://localhost:8000/api/listings/?page=1',
  results: Array.from({ length: 5 }, (_, i) => ({ id: i + 21, name: `Listing ${i + 21}` })),
}

describe('useListings', () => {
  it('fetches the first page and exposes pagination info', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/', () => HttpResponse.json(PAGE_ONE)),
    )
    const { result } = renderWithClient(() => useListings({}))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.pages[0].results).toHaveLength(20)
    expect(result.current.hasNextPage).toBe(true)
  })

  it('fetches the next page when fetchNextPage is called', async () => {
    let callCount = 0
    server.use(
      http.get('http://localhost:8000/api/listings/', () => {
        callCount += 1
        return HttpResponse.json(callCount === 1 ? PAGE_ONE : PAGE_TWO)
      }),
    )
    const { result } = renderWithClient(() => useListings({}))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    result.current.fetchNextPage()
    await waitFor(() => expect(result.current.data.pages).toHaveLength(2))
    expect(result.current.data.pages[1].results).toHaveLength(5)
    expect(result.current.hasNextPage).toBe(false)
  })

  it('includes filter params in the request', async () => {
    let capturedUrl
    server.use(
      http.get('http://localhost:8000/api/listings/', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json(PAGE_ONE)
      }),
    )
    const { result } = renderWithClient(() =>
      useListings({ category: 'hotels', zone: 'Adum', search: 'lodge', minPrice: 100, maxPrice: 500, ordering: 'price_amount' }),
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const url = new URL(capturedUrl)
    expect(url.searchParams.get('category')).toBe('hotels')
    expect(url.searchParams.get('zone')).toBe('Adum')
    expect(url.searchParams.get('search')).toBe('lodge')
    expect(url.searchParams.get('min_price')).toBe('100')
    expect(url.searchParams.get('max_price')).toBe('500')
    expect(url.searchParams.get('ordering')).toBe('price_amount')
  })

  it('includes kind and verified filter params in the request', async () => {
    let capturedUrl
    server.use(
      http.get('http://localhost:8000/api/listings/', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json(PAGE_ONE)
      }),
    )
    const { result } = renderWithClient(() =>
      useListings({ kind: 'product', verified: true }),
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const url = new URL(capturedUrl)
    expect(url.searchParams.get('kind')).toBe('product')
    expect(url.searchParams.get('verified')).toBe('true')
  })

  it('omits verified when falsy', async () => {
    let capturedUrl
    server.use(
      http.get('http://localhost:8000/api/listings/', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json(PAGE_ONE)
      }),
    )
    const { result } = renderWithClient(() => useListings({ verified: false }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const url = new URL(capturedUrl)
    expect(url.searchParams.has('verified')).toBe(false)
  })

  it('refetches when filters change (different query key)', async () => {
    let requestCount = 0
    server.use(
      http.get('http://localhost:8000/api/listings/', () => {
        requestCount += 1
        return HttpResponse.json(PAGE_ONE)
      }),
    )
    const queryClient = new QueryClient()
    const { result, rerender } = renderHook(
      ({ filters }) => useListings(filters),
      {
        initialProps: { filters: { category: 'hotels' } },
        wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
      },
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(requestCount).toBe(1)
    rerender({ filters: { category: 'food' } })
    await waitFor(() => expect(requestCount).toBe(2))
  })
})
