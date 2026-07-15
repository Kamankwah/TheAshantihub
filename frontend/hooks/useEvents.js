import { useInfiniteQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// Events tab (docs/BUSINESS_EVENTS_ROADMAP.md Phase 6) — mirrors useListings'
// infinite-query pattern exactly. GET /api/events/ only supports `category`
// (slug), `zone` (name) and `search` filters — no price range/ordering/kind
// (there's no product/service split for events, and no per-event price on
// the Event model), so buildQueryString here is a strict subset of
// useListings' version rather than the same shared function.
function buildQueryString(filters, page) {
  const params = new URLSearchParams()
  if (filters.category) params.set('category', filters.category)
  if (filters.zone) params.set('zone', filters.zone)
  if (filters.search) params.set('search', filters.search)
  if (page) params.set('page', page)
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function useEvents(filters = {}) {
  return useInfiniteQuery({
    queryKey: ['events', filters],
    queryFn: ({ pageParam }) => apiFetch(`/api/events/${buildQueryString(filters, pageParam)}`),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => {
      if (!lastPage.next) return undefined
      return new URL(lastPage.next).searchParams.get('page')
    },
  })
}
