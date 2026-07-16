import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/core/contact-messages/ — staff-only (contact_messages.manage
// permission). Paginated ({count, next, previous, results}), same
// convention as useReviewsModerationQueue.js (as opposed to
// useModerationQueue.js/useHeroModerationQueue.js's unpaginated arrays) —
// callers must read `data?.results`, not `data` directly.
export function useContactMessagesQueue() {
  return useQuery({
    queryKey: ['contact-messages-queue'],
    queryFn: () => apiFetch('/api/core/contact-messages/'),
  })
}
