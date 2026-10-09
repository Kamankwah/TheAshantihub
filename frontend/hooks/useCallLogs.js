import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/calls/ — a DRF page; read data?.results. Scoped server-side to
// own calls, the team's (calls.view_team) or everyone's (calls.view_all).
// day: 'today' narrows to today's calls and adds data.summary {logged, connected}.
export function useCallLogs({ day, enabled = true } = {}) {
  return useQuery({
    queryKey: ['call-logs', day ?? null],
    queryFn: () => apiFetch(day ? `/api/calls/?day=${encodeURIComponent(day)}` : '/api/calls/'),
    enabled,
  })
}
