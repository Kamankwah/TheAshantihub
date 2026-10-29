import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// Whether sponsored ads are charged yet: GET /api/listings/promotions/pricing/ -> {enabled: bool}.
// No price is ever read from here; while it is off the dashboard says "Free for now".
export const usePromotionPricing = (enabled = true) =>
  useQuery({ queryKey: ['promotion-pricing'], queryFn: () => apiFetch('/api/listings/promotions/pricing/'), enabled })

// The owner's flash-sale invitations: GET /api/marketing/owner/flash-sales/ -> {results: [{sale_id, name, discount_pct,
// starts_at, ends_at, sale_status, answer, listings: [{id, name, normal_price, sale_price, state}]}]}.
export const useFlashInvitations = (enabled = true) =>
  useQuery({ queryKey: ['owner-flash-invitations'], queryFn: () => apiFetch('/api/marketing/owner/flash-sales/'), enabled })
