import { useQuery } from '@tanstack/react-query'
import { apiDelete, apiFetch, apiPatch, apiPost } from '../apiClient.js'

// Flash sales and coupons (Marketing canvas 08-11). Query keys start with 'marketing-'.
// While the owner's checkout switch is off, every payload carries promos_enabled:false and an
// off_notice; staff can still draft and schedule.

// GET /api/marketing/flash-sales/ — {results: [sale], counts: {status: n}, promos_enabled, off_notice, threshold}
export const useFlashSales = () => useQuery({ queryKey: ['marketing-flash-sales'], queryFn: () => apiFetch('/api/marketing/flash-sales/') })

// GET /api/marketing/flash-sales/{id}/ — sale + listings [{id, name, business, normal_price, sale_price, in_stock, state, problem}]
export const useFlashSale = (id) => useQuery({ queryKey: ['marketing-flash-sale', id], queryFn: () => apiFetch(`/api/marketing/flash-sales/${id}/`), enabled: !!id && id !== 'new' })

// GET eligible/?q=&sale= — listings that may join
export const useEligibleListings = (q, sale, enabled) => useQuery({
  queryKey: ['marketing-flash-eligible', q, sale],
  queryFn: () => apiFetch(`/api/marketing/flash-sales/eligible/?q=${encodeURIComponent(q || '')}${sale ? `&sale=${sale}` : ''}`),
  enabled,
})

export const createFlashSale = (body) => apiPost('/api/marketing/flash-sales/', body)
export const updateFlashSale = (id, body) => apiPatch(`/api/marketing/flash-sales/${id}/`, body)
export const addFlashListings = (id, listing_ids) => apiPost(`/api/marketing/flash-sales/${id}/listings/`, { listing_ids })
export const removeFlashListing = (id, listingId) => apiDelete(`/api/marketing/flash-sales/${id}/listings/${listingId}/`)
export const flashSaleAction = (id, action) => apiPost(`/api/marketing/flash-sales/${id}/${action}/`, {})

// GET /api/marketing/coupons/ — {results: [coupon], kpis: {live, waiting, paused, redeemed_7d, cost_7d, most_still_payable}, promos_enabled, off_notice, threshold}
export const useCoupons = () => useQuery({ queryKey: ['marketing-coupons'], queryFn: () => apiFetch('/api/marketing/coupons/') })
// GET /api/marketing/coupons/{id}/
export const useCoupon = (id) => useQuery({ queryKey: ['marketing-coupon', id], queryFn: () => apiFetch(`/api/marketing/coupons/${id}/`), enabled: !!id && id !== 'new' })
export const createCoupon = (body) => apiPost('/api/marketing/coupons/', body)
export const updateCoupon = (id, body) => apiPatch(`/api/marketing/coupons/${id}/`, body)
export const couponAction = (id, action) => apiPost(`/api/marketing/coupons/${id}/${action}/`, {})
export const deleteCoupon = (id) => apiDelete(`/api/marketing/coupons/${id}/`)

// GET /api/categories (existing) is used for the "Applies to" list by the editor.
