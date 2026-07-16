import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// `enabled` (default true) — see useKYCQueue.js's identical convention,
// used the same way by OverviewPanel (gating on users.view).
export function useCustomers({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['staff-customers'],
    queryFn: () => apiFetch('/api/accounts/customers/'),
    enabled,
  })
}
