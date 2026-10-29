import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// The public seller page: GET /api/listings/sellers/<id>/ -> {id, name, since, counts}. A 404 means the
// business is hidden or unknown.
export function useSeller(id) {
  return useQuery({
    queryKey: ['seller', id],
    queryFn: () => apiFetch(`/api/listings/sellers/${id}/`),
    enabled: id != null,
    retry: false,
  })
}

async function allPages(path, sellerId) {
  const rows = []
  let page = 1
  // The seller page shows every live row, so follow `next` (capped, so a bad server can't loop forever).
  while (page && page <= 25) {
    const data = await apiFetch(`${path}?seller=${sellerId}&page=${page}`)
    rows.push(...(data.results || []))
    page = data.next ? page + 1 : 0
  }
  return rows
}

// Every live listing / event of one seller (the `?seller=` filter on the public lists).
export function useSellerListings(id, enabled) {
  return useQuery({
    queryKey: ['seller-listings', id],
    queryFn: () => allPages('/api/listings/', id),
    enabled: enabled && id != null,
  })
}

export function useSellerEvents(id, enabled) {
  return useQuery({
    queryKey: ['seller-events', id],
    queryFn: () => allPages('/api/events/', id),
    enabled: enabled && id != null,
  })
}
