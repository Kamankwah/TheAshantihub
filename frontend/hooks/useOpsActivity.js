import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

const query = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString()

// GET /api/activity/?role=&verb=&actor=&since=&until=&mine=&page= — a DRF page of the
// staff record the caller may see. `verb` takes comma-separated prefixes. The 'activity'
// key is what the live feed invalidates, so the list follows new events.
export function useActivityPage(params) {
  const q = query(params)
  return useQuery({ queryKey: ['activity', 'page', q], queryFn: () => apiFetch(`/api/activity/?${q}`), placeholderData: keepPreviousData })
}

// GET /api/activity/people/ — [{id, name, role}]: staff whose actions the caller can see.
export function useActivityPeople() {
  return useQuery({ queryKey: ['activity', 'people'], queryFn: () => apiFetch('/api/activity/people/') })
}

// GET /api/activity/chain-status/ — {checked: false} until the nightly check has run, else
// {checked: true, checked_at, ok, events}.
export function useChainStatus() {
  return useQuery({ queryKey: ['activity', 'chain-status'], queryFn: () => apiFetch('/api/activity/chain-status/') })
}

// GET /api/field/visits/team/?day=today|YYYY-MM-DD&scout=&purpose=&flagged=1
//   {day, is_today, radius_m, scouts: [{id, name}], summary: {total, still_there, checked_out, flagged, team_total},
//    truncated, results: [visit]} — visit as in useVisits plus fix/pin. Follows 'team-visits'.
export function useTeamVisits(params) {
  const q = query(params)
  return useQuery({ queryKey: ['team-visits', q], queryFn: () => apiFetch(`/api/field/visits/team/?${q}`), placeholderData: keepPreviousData })
}
