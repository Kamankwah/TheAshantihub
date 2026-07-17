import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/events/moderation/pending/?status=pending|approved|rejected —
// staff-only (event.approve), unpaginated (mirrors useModerationQueue.js's
// listings equivalent). The path keeps its historical "pending" segment; the
// tab is the query param.
export function useEventModerationQueue({ status = 'pending', enabled = true } = {}) {
  return useQuery({
    queryKey: ['event-moderation-queue', status],
    queryFn: () => apiFetch(`/api/events/moderation/pending/?status=${status}`),
    enabled,
  })
}
