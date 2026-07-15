import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// Mirrors useModerationQueue.js's shape exactly, for the staff-facing hero
// media approval queue (docs/BUSINESS_EVENTS_ROADMAP.md Phase 2).
export function useHeroModerationQueue() {
  return useQuery({
    queryKey: ['hero-moderation-queue'],
    queryFn: () => apiFetch('/api/listings/hero/pending/'),
  })
}
