import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/field/prospects/?status= — the scout's own, not yet registered:
// {counts: {all, new, interested, follow_up, not_interested, registered},
//  signed_up_this_month, listings_live_this_month, results: [...]}; each result carries
// pipeline: {stage, listings: {drafts, awaiting_owner, lapsed, pending_approval, live}}. status "all" (default) leaves out
// the registered ones.
//
// Operations and Super Admin get every scout's prospects (each result carries scout_id and scout_name); `scout` narrows to
// one (?scout=<id>). A scout's own list ignores it. listings_live_this_month is present only when the list is one scout's.
export function useProspects(status = 'all', { enabled = true, scout = '' } = {}) {
  return useQuery({
    queryKey: ['prospects', status, scout ? String(scout) : ''],
    queryFn: () => apiFetch(`/api/field/prospects/?status=${encodeURIComponent(status)}${scout ? `&scout=${encodeURIComponent(scout)}` : ''}`),
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
