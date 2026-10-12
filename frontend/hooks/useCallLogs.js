import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/calls/ — a DRF page; read data?.results. Scoped server-side to
// own calls, the team's (calls.view_team) or everyone's (calls.view_all).
// day: 'today' narrows to today's calls and adds data.summary {logged, connected}.
// scope: 'mine' | 'team' (my direct reports only); omitted keeps the server default.
// With day='today' the page also carries strip {mine, out, in, connected, no_answer, follow_ups, team|null}.
export function useCallLogs({ day, scope, enabled = true } = {}) {
  const params = new URLSearchParams()
  if (day) params.set('day', day)
  if (scope) params.set('scope', scope)
  const query = params.toString()
  return useQuery({
    queryKey: ['call-logs', day ?? null, scope ?? null],
    queryFn: () => apiFetch(`/api/calls/${query ? `?${query}` : ''}`),
    enabled,
  })
}
