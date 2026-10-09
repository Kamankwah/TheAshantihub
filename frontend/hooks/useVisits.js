import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/field/visits/?range=week|month|flagged — a DRF page (read
// data?.results) plus data.summary {done, avg_minutes, flagged} for THIS week.
// `limit` is the page size: "Show more" raises it. Pass scout (an id) only as
// Operations, who reads a scout's visits read-only.
export function useVisits(range = 'week', limit = 50, { scout } = {}) {
  const params = new URLSearchParams({ range, page_size: String(limit) })
  if (scout) params.set('scout', String(scout))
  return useQuery({
    queryKey: ['visits', range, limit, scout ?? null],
    queryFn: () => apiFetch(`/api/field/visits/?${params.toString()}`),
    placeholderData: keepPreviousData,
  })
}

// GET /api/field/visits/open/ → {visit: {...} | null}: the caller's open visit.
export function useOpenVisit({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['visit-open'],
    queryFn: () => apiFetch('/api/field/visits/open/'),
    enabled,
  })
}

// GET /api/field/visit-targets/ — a plain array of the places a scout can
// check in at (their businesses and open verification assignments), each with
// its pin when it has one. No location is sent: the client sorts by distance
// from the fix it takes at check-in.
export function useVisitTargets({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['visit-targets'],
    queryFn: () => apiFetch('/api/field/visit-targets/'),
    enabled,
  })
}
