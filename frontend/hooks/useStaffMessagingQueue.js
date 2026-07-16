import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/messaging/staff/ — every support conversation, staff-only
// (messaging.manage). Paginated ({count, next, previous, results}), same
// convention as useReviewsModerationQueue.js/useEscrowLedger.js — callers
// must read `data?.results`, not `data` directly. Each row carries a
// computed `needs_reply` boolean (open + latest message not from staff).
export function useStaffMessagingQueue() {
  return useQuery({
    queryKey: ['staff-messaging-queue'],
    queryFn: () => apiFetch('/api/messaging/staff/'),
  })
}
