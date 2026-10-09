import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/portfolio/owner/changes/ — what the owner's account manager
// changed for them in the last 30 days, newest first, each with its 7-day
// undo window. A plain array (not a DRF page).
export function useOwnerChanges({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['owner-changes'],
    queryFn: () => apiFetch('/api/portfolio/owner/changes/'),
    enabled,
  })
}
