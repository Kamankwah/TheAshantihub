import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/core/analytics/ — staff-only (analytics.view) marketplace snapshot.
// A single aggregate object of REAL counts derived from existing models (no
// paginated envelope, no time-series): {customers, business_owners,
// business_owners_by_kyc:{pending,verified,rejected}, listings_total,
// listings_by_status:{...}, listings_by_kind:{...}, orders_total,
// orders_by_status:{...}, events_total, events_by_status:{...}}.
export function useAnalyticsOverview() {
  return useQuery({
    queryKey: ['analytics-overview'],
    queryFn: () => apiFetch('/api/core/analytics/'),
  })
}
