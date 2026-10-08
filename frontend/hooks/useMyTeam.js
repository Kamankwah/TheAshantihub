import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/accounts/staff/team/ — the caller's direct reports, a plain array.
export function useMyTeam() {
  return useQuery({ queryKey: ['my-team'], queryFn: () => apiFetch('/api/accounts/staff/team/') })
}
