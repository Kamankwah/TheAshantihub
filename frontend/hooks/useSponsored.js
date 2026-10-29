import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/storefront/sponsored/?category=<id>&exclude=<id>&limit=12 — the
// public sponsored feed (plain array of card rows, live sponsored listings in
// that category and its sub-categories, the anchor listing left out). Not the
// staff Marketing list at /api/listings/sponsored/.
export function useSponsored({ category, exclude } = {}) {
  const params = new URLSearchParams()
  if (category != null) params.set('category', String(category))
  if (exclude != null) params.set('exclude', String(exclude))
  params.set('limit', '12')
  return useQuery({
    queryKey: ['storefront-sponsored', category ?? null, exclude ?? null],
    queryFn: () => apiFetch(`/api/storefront/sponsored/?${params}`),
    enabled: category != null,
  })
}
