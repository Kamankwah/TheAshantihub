import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/calls/ — a DRF page; read data?.results. Scoped server-side to
// own calls, the team's (calls.view_team) or everyone's (calls.view_all).
// day: 'today' narrows to today's calls and adds data.summary {logged, connected}.
// scope: 'mine' | 'team' (my direct reports only); omitted keeps the server default.
// With day='today' the page also carries strip {mine, out, in, connected, no_answer, follow_ups, team|null}.
// filters: extra query params for the Support call log, e.g. {purpose, outcome, direction, from, to,
// staff, counterpart_type, counterpart_id, page}. Empty values are left out. With from/to the page also
// carries kpis {logged, connected, inbound, outbound, not_reached, avg_connected_seconds, follow_ups,
// follow_ups_due_today}.
export function useCallLogs({ day, scope, enabled = true, filters } = {}) {
  const params = new URLSearchParams()
  if (day) params.set('day', day)
  if (scope) params.set('scope', scope)
  const extra = {}
  for (const [key, value] of Object.entries(filters || {})) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value))
      extra[key] = String(value)
    }
  }
  const query = params.toString()
  return useQuery({
    queryKey: ['call-logs', day ?? null, scope ?? null, ...(Object.keys(extra).length ? [extra] : [])],
    queryFn: () => apiFetch(`/api/calls/${query ? `?${query}` : ''}`),
    enabled,
  })
}
