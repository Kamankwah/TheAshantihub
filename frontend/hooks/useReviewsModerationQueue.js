import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/reviews/moderation/?status=pending|approved|rejected — staff-only
// (reviews.moderate permission). Reviews are pre-moderated, so this is a real
// Pending/Approved/Rejected queue like the KYC/listings/hero ones.
//
// Unlike useModerationQueue.js/useHeroModerationQueue.js (both unpaginated
// arrays), this endpoint IS paginated ({count, next, previous, results}) —
// callers must read `data?.results`, not `data` directly. ModerationQueueTabs'
// itemsOf() normalizes both shapes, so the panel itself doesn't have to care.
export function useReviewsModerationQueue({ status = 'pending', enabled = true } = {}) {
  return useQuery({
    queryKey: ['reviews-moderation-queue', status],
    queryFn: () => apiFetch(`/api/reviews/moderation/?status=${status}`),
    enabled,
  })
}
