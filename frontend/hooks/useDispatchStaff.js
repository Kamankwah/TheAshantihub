import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/orders/dispatches/ — active, unsuspended dispatch staff
// (delivery.manage). NOT paginated: a plain array of {id, full_name}. It says
// nothing about whether a rider is currently free, only that the account is
// active.
export function useDispatchStaff({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['dispatch-staff'],
    queryFn: () => apiFetch('/api/orders/dispatches/'),
    enabled,
  })
}
