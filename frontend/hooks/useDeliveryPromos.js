import { useQuery } from '@tanstack/react-query'
import { apiFetch, apiPost } from '../apiClient.js'

// Free-delivery promos. Owner: GET /api/marketing/owner/delivery-promos/ — {results: [promo]} of the caller's own.
// Staff (site_promo.manage): GET /api/marketing/delivery-promos/?status=pending|approved|rejected|paused|ended.
// promo = {id, name, business_id, business, starts_at, ends_at, all_items, listings: [{id, name}], status,
//   effective_status, live, source, rejection_reason, reviewed_at, created_at, covered_orders, covered_total,
//   funded_by ('business'|'platform'), budget_cap (string|null), spent (string, platform only, else null),
//   awaiting_approval (a platform promo waiting on the approvals inbox), approval_id}. Both reads are {results}.
// Staff (delivery_promo.fund): POST /api/marketing/delivery-promos/platform/ -> 201 {...promo, approval: {id, status}}.
export const useOwnerDeliveryPromos = () =>
  useQuery({ queryKey: ['owner-delivery-promos'], queryFn: () => apiFetch('/api/marketing/owner/delivery-promos/') })

export const useStaffDeliveryPromos = (status) =>
  useQuery({ queryKey: ['marketing-delivery-promos', status], queryFn: () => apiFetch(`/api/marketing/delivery-promos/?status=${status}`) })

export const createOwnerDeliveryPromo = (body) => apiPost('/api/marketing/owner/delivery-promos/', body)
export const ownerDeliveryPromoAction = (id, action) => apiPost(`/api/marketing/owner/delivery-promos/${id}/${action}/`, {})
export const staffDeliveryPromoAction = (id, action, body = {}) => apiPost(`/api/marketing/delivery-promos/${id}/${action}/`, body)

// AshantiHub-paid promo for one business; always waits for Operations or a Super Admin.
export const createPlatformDeliveryPromo = (body) => apiPost('/api/marketing/delivery-promos/platform/', body)

// GET /api/marketing/delivery-promos/business-search/?q= (delivery_promo.fund) -> {results: [{id, name}]}; asked from 2 characters.
export const usePlatformPromoBusinessSearch = (term) => {
  const q = (term || '').trim()
  return useQuery({
    queryKey: ['platform-promo-business-search', q],
    queryFn: () => apiFetch(`/api/marketing/delivery-promos/business-search/?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  })
}
