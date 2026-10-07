import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/calls/ — a DRF page; read data?.results. Scoped server-side to
// own calls, the team's (calls.view_team) or everyone's (calls.view_all).
export function useCallLogs() {
  return useQuery({ queryKey: ['call-logs'], queryFn: () => apiFetch('/api/calls/') })
}
