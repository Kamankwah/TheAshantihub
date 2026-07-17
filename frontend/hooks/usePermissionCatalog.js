import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/accounts/permissions/ — every assignable permission (codename +
// description), staff-only (staff.manage). Backs the per-staffer permission
// editor's checklist. Plain array, not paginated. `enabled` lets the editor
// defer the fetch until a staffer's permission panel is actually opened.
export function usePermissionCatalog({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['permission-catalog'],
    queryFn: () => apiFetch('/api/accounts/permissions/'),
    enabled,
  })
}
