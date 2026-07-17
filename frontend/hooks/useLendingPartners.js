import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/credit/partners/ — the lending-partner directory (credit app,
// item 16). Auth-required; the backend scopes the result: a business owner
// sees only active partners, a staffer with credit.manage sees all of them.
// Plain array, not paginated. Replaces the hardcoded LENDING_PARTNERS that
// used to live in frontend/components/dashboard/theme.js.
export function useLendingPartners({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['lending-partners'],
    queryFn: () => apiFetch('/api/credit/partners/'),
    enabled,
  })
}
