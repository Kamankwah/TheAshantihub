import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/accounts/scout-assignments/ — every assignment, for the admin who
// assigns scouts (item 11, scouts.assign). Paginated ({count, results}).
export function useScoutAssignments({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['scout-assignments'],
    queryFn: () => apiFetch('/api/accounts/scout-assignments/'),
    enabled,
  })
}
