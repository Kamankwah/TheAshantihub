import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// "This week" lines under the KYC and Listings queues (counts since Monday).
// Best-effort: the line is simply left out when the numbers can't be loaded.
// GET /api/accounts/kyc/stats/ -> {week_verified, week_rejected}
export function useKycStats({ enabled = true } = {}) {
  return useQuery({ queryKey: ['kyc-stats'], queryFn: () => apiFetch('/api/accounts/kyc/stats/'), enabled, retry: false })
}

// GET /api/listings/moderation/stats/ -> {week_published, week_rejected}
export function useListingsStats({ enabled = true } = {}) {
  return useQuery({ queryKey: ['moderation-stats'], queryFn: () => apiFetch('/api/listings/moderation/stats/'), enabled, retry: false })
}
