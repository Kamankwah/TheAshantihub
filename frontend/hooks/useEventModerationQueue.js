import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/events/moderation/pending/ — staff-only (event.approve),
// unpaginated (mirrors useModerationQueue.js's listings equivalent).
export function useEventModerationQueue() {
  return useQuery({
    queryKey: ['event-moderation-queue'],
    queryFn: () => apiFetch('/api/events/moderation/pending/'),
  })
}
