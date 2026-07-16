import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/events/pricing-tiers/ — public, unpaginated list of the 5 fixed
// event-visibility durations and their live price. Powers the visibility
// dropdown on EventSubmissionPanel's submission form.
export function useEventPricingTiers() {
  return useQuery({
    queryKey: ['event-pricing-tiers'],
    queryFn: () => apiFetch('/api/events/pricing-tiers/'),
  })
}
