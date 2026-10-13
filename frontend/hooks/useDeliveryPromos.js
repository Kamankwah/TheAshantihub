import { useQuery } from '@tanstack/react-query'
import { apiFetch, apiPost } from '../apiClient.js'

// Free-delivery promos. Owner: GET /api/marketing/owner/delivery-promos/ — {results: [promo]} of the caller's own.
// Staff (site_promo.manage): GET /api/marketing/delivery-promos/?status=pending|approved|rejected|paused|ended.
// promo = {id, name, business_id, business, starts_at, ends_at, all_items, listings: [{id, name}], status,
//   effective_status, live, source, rejection_reason, reviewed_at, created_at}. Both reads are {results}.
export const useOwnerDeliveryPromos = () =>
  useQuery({ queryKey: ['owner-delivery-promos'], queryFn: () => apiFetch('/api/marketing/owner/delivery-promos/') })

export const useStaffDeliveryPromos = (status) =>
  useQuery({ queryKey: ['marketing-delivery-promos', status], queryFn: () => apiFetch(`/api/marketing/delivery-promos/?status=${status}`) })

export const createOwnerDeliveryPromo = (body) => apiPost('/api/marketing/owner/delivery-promos/', body)
export const ownerDeliveryPromoAction = (id, action) => apiPost(`/api/marketing/owner/delivery-promos/${id}/${action}/`, {})
export const staffDeliveryPromoAction = (id, action, body = {}) => apiPost(`/api/marketing/delivery-promos/${id}/${action}/`, body)
