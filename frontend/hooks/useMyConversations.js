import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/messaging/conversations/ — the signed-in caller's own support
// conversations (Customer or BusinessOwner), full message thread included.
// No pagination_class on the backend view, so this is a plain unpaginated
// array — same convention as useOrders.js/useMyEvents.js, not the
// paginated-envelope shape the staff-facing useStaffMessagingQueue() has.
// Starting a new conversation (POST /api/messaging/conversations/) and
// replying within one (POST /api/messaging/conversations/{id}/messages/)
// are plain apiPost calls inside the consuming component's handler, not
// hooks — same established mutation convention as everywhere else in this
// app. `enabled` mirrors useCart.js's convention, so a caller (MessagingCenter,
// mounted for both signed-in and signed-out visitors) can skip firing this
// for a signed-out caller who has no conversations to fetch and would just
// get a 401.
export function useMyConversations(enabled = true) {
  return useQuery({
    queryKey: ['my-conversations'],
    queryFn: () => apiFetch('/api/messaging/conversations/'),
    enabled,
  })
}
