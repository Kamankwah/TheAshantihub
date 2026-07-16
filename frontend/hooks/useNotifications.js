import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/notifications/ — the signed-in caller's own notifications
// (customer / business owner / staff, scoped server-side by the auth token),
// most-recent first. The backend wraps the list in an envelope carrying the
// live unread count: `{ unread_count, results }` — the bell badge needs the
// count without walking the whole list. Unpaginated (same convention as
// useOrders/useMyConversations), just with that count alongside `results`.
//
// `enabled` mirrors useCart.js's convention — AshantiHub passes false until
// the session-restore fetch settles and a user is present, so anonymous
// visitors and mid-restore renders don't fire a doomed request. Marking a
// notification read / read-all are plain apiPost calls in the consuming
// component's handler (then refetch()), not hooks — the established mutation
// convention everywhere in this app.
export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiFetch('/api/notifications/'),
    enabled,
  })
}
