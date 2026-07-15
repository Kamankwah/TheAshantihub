import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/reviews/moderation/ — staff-only (reviews.moderate permission).
// Unlike useModerationQueue.js/useHeroModerationQueue.js (both unpaginated
// arrays), this endpoint IS paginated ({count, next, previous, results}) —
// callers must read `data?.results`, not `data` directly. It's a full
// queue (every review regardless of status), not a pending-only one, since
// moderation here is reactive-by-browsing rather than approve/reject.
export function useReviewsModerationQueue() {
  return useQuery({
    queryKey: ['reviews-moderation-queue'],
    queryFn: () => apiFetch('/api/reviews/moderation/'),
  })
}
