import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/calls/purposes/ — [{value, label}] for the caller's role.
export function useCallPurposes() {
  return useQuery({ queryKey: ['call-purposes'], queryFn: () => apiFetch('/api/calls/purposes/'), staleTime: Infinity })
}
