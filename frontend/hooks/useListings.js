import { useInfiniteQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

function buildQueryString(filters, page) {
  const params = new URLSearchParams()
  if (filters.category) params.set('category', filters.category)
  if (filters.zone) params.set('zone', filters.zone)
  if (filters.search) params.set('search', filters.search)
  if (filters.minPrice != null) params.set('min_price', filters.minPrice)
  if (filters.maxPrice != null) params.set('max_price', filters.maxPrice)
  if (filters.ordering) params.set('ordering', filters.ordering)
  if (filters.kind) params.set('kind', filters.kind)
  if (filters.verified) params.set('verified', 'true')
  if (page) params.set('page', page)
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function useListings(filters) {
  return useInfiniteQuery({
    queryKey: ['listings', filters],
    queryFn: ({ pageParam }) => apiFetch(`/api/listings/${buildQueryString(filters, pageParam)}`),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => {
      if (!lastPage.next) return undefined
      return new URL(lastPage.next).searchParams.get('page')
    },
  })
}
