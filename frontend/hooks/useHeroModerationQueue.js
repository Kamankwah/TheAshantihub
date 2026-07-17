import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// Mirrors useModerationQueue.js's shape exactly, for the staff-facing hero
// media approval queue (docs/BUSINESS_EVENTS_ROADMAP.md Phase 2).
// `status` (default "pending") selects the three-state moderation tab
// (pending/approved/rejected) via the backend's `?status=` param (staff
// moderation-queue restructuring). `enabled` (default true) — see
// useKYCQueue.js's identical convention, used the same way by OverviewPanel
// (gating on hero_media.approve).
export function useHeroModerationQueue({ status = 'pending', enabled = true } = {}) {
  return useQuery({
    queryKey: ['hero-moderation-queue', status],
    queryFn: () => apiFetch(`/api/listings/hero/pending/?status=${status}`),
    enabled,
  })
}
