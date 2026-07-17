import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/accounts/kyc/{id}/ — staff-only (kyc.approve), the full KYC detail
// (BusinessOwnerKYCDetailSerializer): Ghana card number + front/back images,
// GPS address, business info, formal-registration docs. `enabled` defaults to
// false so KYCQueuePanel only fetches a submission's detail once its "View
// Details" row is actually expanded (same enabled-gated convention as
// useEventAttendees.js).
export function useKYCDetail(id, { enabled = false } = {}) {
  return useQuery({
    queryKey: ['kyc-detail', id],
    queryFn: () => apiFetch(`/api/accounts/kyc/${id}/`),
    enabled: enabled && id != null,
  })
}
