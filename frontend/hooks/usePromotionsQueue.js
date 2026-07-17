import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/listings/promotions/?status=active|expired|cancelled — staff-only
// (promotions.manage), plain array (not paginated).
//
// Promotions aren't moderated: a business owner buys one and it goes live
// immediately, so these tabs are a lifecycle, not an approval flow. "Expired"
// is derived server-side from the time window rather than read off `status` —
// nothing ever flips a finished promotion's status, by design.
export function usePromotionsQueue({ status = 'active', enabled = true } = {}) {
  return useQuery({
    queryKey: ['promotions-queue', status],
    queryFn: () => apiFetch(`/api/listings/promotions/?status=${status}`),
    enabled,
  })
}
