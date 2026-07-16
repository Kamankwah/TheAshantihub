import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// `enabled` (default true) lets a caller that only holds a KYC-adjacent
// permission conditionally (e.g. OverviewPanel, gating on kyc.approve)
// skip firing this for a session that lacks kyc.approve and would just get
// a 403 — mirrors useCart.js's enabled convention.
export function useKYCQueue({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['kyc-queue'],
    queryFn: () => apiFetch('/api/accounts/kyc/pending/'),
    enabled,
  })
}
