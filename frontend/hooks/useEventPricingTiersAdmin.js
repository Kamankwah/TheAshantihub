import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/events/pricing-tiers/manage/ — staff-only (event_pricing.manage
// OR event_pricing.approve), unpaginated. Includes each tier's pending
// proposal (if any) on top of the public useEventPricingTiers.js shape.
export function useEventPricingTiersAdmin() {
  return useQuery({
    queryKey: ['event-pricing-tiers-admin'],
    queryFn: () => apiFetch('/api/events/pricing-tiers/manage/'),
  })
}
