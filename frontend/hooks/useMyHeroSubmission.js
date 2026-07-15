import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/hero/mine/ — the calling business owner's most relevant
// HeroMediaSubmission (outstanding one if there is one, else the most recent
// of any status, else nothing). Mirrors useMySubscription.js's "no
// subscription yet" convention: "nothing yet" is a 200 with `{}`, not a 404,
// so callers should check for the absence of an `id` field on the returned
// data, not query error state.
export function useMyHeroSubmission(enabled = true) {
  return useQuery({
    queryKey: ['my-hero-submission'],
    queryFn: () => apiFetch('/api/hero/mine/'),
    enabled,
  })
}
