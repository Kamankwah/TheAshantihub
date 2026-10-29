import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/catalogue/stock/?page= — the Needs-restocking list. Paginated, 20 a
// page: read data.pages[n].results; count, tracked_offers, untracked_offers and
// settings come from data.pages[0]. fetchNextPage() follows DRF's `next`. A
// stock write invalidates the ['catalogue-stock'] prefix.
export function useNeedsRestocking({ enabled = true } = {}) {
  return useInfiniteQuery({
    queryKey: ['catalogue-stock', 'list'],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (pageParam) params.set('page', pageParam)
      const qs = params.toString()
      return apiFetch(`/api/catalogue/stock/${qs ? `?${qs}` : ''}`)
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => (lastPage?.next ? new URL(lastPage.next).searchParams.get('page') || undefined : undefined),
    enabled,
  })
}

// GET /api/catalogue/stock/{id}/line/ -> {listing_id, line, cover}
export function useStockLine(listingId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['catalogue-stock', 'line', listingId],
    queryFn: () => apiFetch(`/api/catalogue/stock/${listingId}/line/`),
    enabled: enabled && listingId != null,
    retry: false,
  })
}
