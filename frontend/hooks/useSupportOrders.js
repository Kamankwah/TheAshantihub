import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// Support's Order status screen. GET /api/orders/support/?q= finds orders by
// number, customer name or phone (phones come back masked); without q it lists
// the latest. GET /api/orders/support/<id>/ is one order with its timeline.
// Both need orders.support_update. Unpaginated: {results, recent}.
export function useSupportOrderSearch(q = '') {
  const text = q.trim()
  return useQuery({
    queryKey: ['support-orders', 'search', text],
    queryFn: () => apiFetch(`/api/orders/support/${text ? `?q=${encodeURIComponent(text)}` : ''}`),
    placeholderData: keepPreviousData,
  })
}

export function useSupportOrder(id) {
  return useQuery({
    queryKey: ['support-orders', 'detail', id],
    queryFn: () => apiFetch(`/api/orders/support/${id}/`),
    enabled: Boolean(id),
  })
}
