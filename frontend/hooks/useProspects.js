import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/field/prospects/?status= — the scout's own, not yet registered:
// {counts: {all, new, interested, follow_up, not_interested, registered},
//  signed_up_this_month, results: [...]}. status "all" (default) leaves out
// the registered ones.
export function useProspects(status = 'all', { enabled = true } = {}) {
  return useQuery({
    queryKey: ['prospects', status],
    queryFn: () => apiFetch(`/api/field/prospects/?status=${encodeURIComponent(status)}`),
    enabled,
  })
}

// GET /api/calls/counterparts/ — {businesses: [{id, business_name, owner_name,
// phone_masked}], prospects: [{id, name, phone_masked, status}]}: who the
// scout can pick in "Log a call". Phones arrive already masked.
export function useCallCounterparts({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['call-counterparts'],
    queryFn: () => apiFetch('/api/calls/counterparts/'),
    enabled,
  })
}
