import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// The calling staff member's own latest hero decisions (canvas 14, "Decided recently").
export function useHeroMyDecisions({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['marketing-hero-my-decisions'],
    queryFn: () => apiFetch('/api/listings/hero/my-decisions/'),
    enabled,
  })
}

// Real counts for the last 7, 30 or 90 days (canvas 17). Never estimated.
export function useMarketingPeriodAnalytics(days) {
  return useQuery({
    queryKey: ['marketing-analytics', days],
    queryFn: () => apiFetch(`/api/marketing/analytics/?days=${days}`),
  })
}
