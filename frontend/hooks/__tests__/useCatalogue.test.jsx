import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useGroupingState } from '../useCatalogueGrouping.js'
import { useCatalogueSearch } from '../useCatalogueLookup.js'
import { useCatalogueQueue } from '../useCatalogueQueue.js'
import { useNeedsRestocking, useStockLine } from '../useCatalogueStock.js'
import { useOtherSellers } from '../useOtherSellers.js'

const B = 'http://localhost:8000/api/catalogue'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('catalogue hooks', () => {
  it('test_needs_restocking_reads_pages_and_follows_next', async () => {
    const seen = []
    server.use(http.get(`${B}/stock/`, ({ request }) => {
      const page = new URL(request.url).searchParams.get('page')
      seen.push(page)
      return HttpResponse.json(page === '2'
        ? { count: 2, next: null, previous: null, results: [{ listing_id: 2 }], tracked_offers: 2, untracked_offers: 0, settings: {} }
        : { count: 2, next: `${B}/stock/?page=2`, previous: null, results: [{ listing_id: 1 }], tracked_offers: 2, untracked_offers: 0, settings: {} })
    }))
    const { result } = renderWithClient(() => useNeedsRestocking())
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1))
    expect(result.current.hasNextPage).toBe(true)
    await act(async () => { await result.current.fetchNextPage() })
    await waitFor(() => expect(result.current.data.pages).toHaveLength(2))
    expect(result.current.data.pages[1].results[0].listing_id).toBe(2)
    expect(seen).toEqual([null, '2'])
    expect(result.current.hasNextPage).toBe(false)
  })

  it('test_stock_line_reads_the_saved_line', async () => {
    server.use(http.get(`${B}/stock/9/line/`, () => HttpResponse.json({ listing_id: 9, line: 4, cover: null })))
    const { result } = renderWithClient(() => useStockLine(9))
    await waitFor(() => expect(result.current.data?.line).toBe(4))
  })

  it('test_search_is_not_asked_without_a_term', async () => {
    let called = false
    server.use(http.get(`${B}/products/`, () => { called = true; return HttpResponse.json({ results: [], truncated: false }) }))
    const a = renderWithClient(() => useCatalogueSearch(null))
    const b = renderWithClient(() => useCatalogueSearch({ q: '  ' }))
    await new Promise((r) => setTimeout(r, 20))
    expect(called).toBe(false)
    expect(a.result.current.fetchStatus).toBe('idle')
    expect(b.result.current.fetchStatus).toBe('idle')
  })

  it('test_search_sends_q_or_barcode_as_given', async () => {
    const urls = []
    server.use(http.get(`${B}/products/`, ({ request }) => {
      urls.push(new URL(request.url).search)
      return HttpResponse.json({ results: [], truncated: false })
    }))
    const q = renderWithClient(() => useCatalogueSearch({ q: 'milo tin' }))
    await waitFor(() => expect(q.result.current.isSuccess).toBe(true))
    const bc = renderWithClient(() => useCatalogueSearch({ barcode: '5000112548167' }))
    await waitFor(() => expect(bc.result.current.isSuccess).toBe(true))
    expect(urls).toEqual(['?q=milo%20tin', '?barcode=5000112548167'])
  })

  it('test_other_sellers_sends_ordering_and_position_only_when_given', async () => {
    const urls = []
    server.use(http.get(`${B}/listings/5/other-sellers/`, ({ request }) => {
      urls.push(new URL(request.url).search)
      return HttpResponse.json({ catalogue_product: null, featured_offer_id: null, ordering: 'price', offers: [] })
    }))
    const a = renderWithClient(() => useOtherSellers(5))
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true))
    const b = renderWithClient(() => useOtherSellers(5, { ordering: 'availability', position: { lat: 5.6, lng: -0.2 } }))
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true))
    expect(urls).toEqual(['?ordering=price', '?ordering=availability&lat=5.6&lng=-0.2'])
  })

  it('test_queue_reads_the_envelope_for_status_and_page', async () => {
    let search = ''
    server.use(http.get(`${B}/staff/requests/pending/`, ({ request }) => {
      search = new URL(request.url).search
      return HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 3 }] })
    }))
    const { result } = renderWithClient(() => useCatalogueQueue({ status: 'rejected', page: 2 }))
    await waitFor(() => expect(result.current.data?.results[0].id).toBe(3))
    expect(search).toBe('?status=rejected&page=2')
  })

  it('test_grouping_state_reads_the_listing_state', async () => {
    server.use(http.get(`${B}/mine/7/`, () => HttpResponse.json({
      listing: 7, groupable: true, barcode: '036000291452', store_code: false, catalogue_product: null, request: null,
    })))
    const { result } = renderWithClient(() => useGroupingState(7))
    await waitFor(() => expect(result.current.data?.barcode).toBe('036000291452'))
  })
})
