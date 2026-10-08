import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/accounts/staff/two-factor/ — {enabled, required, enabled_at, recovery_codes_left}.
export function useTwoFactorStatus() {
  return useQuery({ queryKey: ['two-factor'], queryFn: () => apiFetch('/api/accounts/staff/two-factor/') })
}
