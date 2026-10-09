import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/portfolio/businesses/<id>/orders/?page_size= — a DRF page of the
// business's paid orders, read-only: {id, number, placed_at, items: [{name,
// quantity}], status, delivery_status, delivered_at, dispute: {reason,
// reason_label, status} | null, problem_flagged}. Never a customer's name,
// phone or address.
export function useBusinessOrders(businessId, pageSize = 5, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['business-orders', String(businessId), pageSize],
    queryFn: () => apiFetch(`/api/portfolio/businesses/${businessId}/orders/?page_size=${pageSize}`),
    enabled: enabled && businessId != null,
    placeholderData: keepPreviousData,
  })
}
