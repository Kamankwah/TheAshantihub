import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/events/mine/ — the signed-in customer or business owner's own
// submitted events, any status, full detail + access_code always included
// (EventOwnerSerializer) regardless of access_level. Unlike useMyHeroSubmission
// this is a plain list (an organizer isn't limited to one outstanding
// submission at a time), so no "no submission yet" empty-object convention
// is needed here — an empty array is already a normal, unambiguous result.
export function useMyEvents() {
  return useQuery({
    queryKey: ['my-events'],
    queryFn: () => apiFetch('/api/events/mine/'),
  })
}
