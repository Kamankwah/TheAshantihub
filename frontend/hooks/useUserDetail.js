import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/accounts/{customers|business-owners}/{id}/ — staff-only
// (users.view to read; PATCH needs users.manage), the full staff view of one account
// (StaffCustomer/BusinessOwnerDetailSerializer). `basePath` is
// '/api/accounts/customers' or '/api/accounts/business-owners'. `enabled`
// defaults to false so UsersPanel only fetches a row's detail once its View/
// Edit panel is expanded (same enabled-gated convention as useKYCDetail.js).
export function useUserDetail(basePath, id, { enabled = false } = {}) {
  return useQuery({
    queryKey: ['user-detail', basePath, id],
    queryFn: () => apiFetch(`${basePath}/${id}/`),
    enabled: enabled && id != null,
    // A 403 is a permission limit, not a transient fault — show it at once.
    retry: (count, error) => error?.status !== 403 && count < 3,
  })
}
