import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/hero/active/ — public, unauthenticated feed of approved,
// non-expired hero-media submissions. Not wired into any UI yet: this is a
// minimal export so Phase 3's hero carousel (docs/BUSINESS_EVENTS_ROADMAP.md)
// can consume it without a separate data-fetching pass.
export function useActiveHero() {
  return useQuery({
    queryKey: ['hero-active'],
    queryFn: () => apiFetch('/api/hero/active/'),
  })
}
