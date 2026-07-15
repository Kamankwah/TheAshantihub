import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/reviews/eligibility/?target_type=&target_id=&organizer_kind= —
// auth required (customer only). Returns {eligible, already_reviewed}. This
// naturally 401s/errors for a signed-out user — the consuming component
// (later phases) is expected to check `user` before even rendering the
// write-review UI, not rely on this hook's error state to gate it.
export function useReviewEligibility({ targetType, targetId, organizerKind } = {}) {
  return useQuery({
    queryKey: ['review-eligibility', targetType, targetId, organizerKind],
    queryFn: () => apiFetch(`/api/reviews/eligibility/?target_type=${targetType}&target_id=${targetId}${organizerKind ? `&organizer_kind=${organizerKind}` : ''}`),
    enabled: targetType != null && targetId != null,
  })
}
