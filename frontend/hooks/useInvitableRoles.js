import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/accounts/staff/invitable-roles/ — role names this staffer may invite.
export function useInvitableRoles() {
  return useQuery({ queryKey: ['invitable-roles'], queryFn: () => apiFetch('/api/accounts/staff/invitable-roles/'), staleTime: Infinity })
}
