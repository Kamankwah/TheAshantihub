import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/events/moderation/{id}/ — staff-only (event.approve), the full
// moderation detail (EventModerationSerializer): description, address, lat/lng,
// media gallery, organizer names, access level, visibility. `enabled` defaults
// to false so EventsModerationPanel only fetches an event's detail once its
// "View" row is expanded (same enabled-gated convention as useKYCDetail.js).
export function useEventModerationDetail(id, { enabled = false } = {}) {
  return useQuery({
    queryKey: ['event-moderation-detail', id],
    queryFn: () => apiFetch(`/api/events/moderation/${id}/`),
    enabled: enabled && id != null,
  })
}
