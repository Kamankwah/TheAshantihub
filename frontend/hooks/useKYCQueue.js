import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// `status` (default "pending") selects the three-state moderation tab
// (pending/approved/rejected) via the backend's `?status=` param (staff
// moderation-queue restructuring). The URL path stays `.../pending/` (its name
// is historical); the param is what actually picks the state.
//
// `enabled` (default true) lets a caller that only holds a KYC-adjacent
// permission conditionally (e.g. OverviewPanel, gating on kyc.approve)
// skip firing this for a session that lacks kyc.approve and would just get
// a 403 — mirrors useCart.js's enabled convention.
export function useKYCQueue({ status = 'pending', enabled = true } = {}) {
  return useQuery({
    queryKey: ['kyc-queue', status],
    queryFn: () => apiFetch(`/api/accounts/kyc/pending/?status=${status}`),
    enabled,
  })
}
