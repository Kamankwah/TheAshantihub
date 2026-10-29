import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// The identity-document review queue (the verified check mark), separate from
// the address queue in useKYCQueue.js. `status` (default "pending") picks the
// three-state tab (pending/approved/rejected) via the backend's `?status=`
// param; the URL path stays `.../identity/pending/` (its name is historical),
// the param is what actually picks the state. An unknown value falls back to
// pending server-side.
//
// `enabled` (default true) lets a caller that holds the kyc.approve permission
// only conditionally skip firing this for a session that would just get a 403
// — mirrors useKYCQueue.js and useCart.js's enabled convention.
export function useIdentityQueue({ status = 'pending', enabled = true } = {}) {
  return useQuery({
    queryKey: ['identity-queue', status],
    queryFn: () => apiFetch(`/api/accounts/kyc/identity/pending/?status=${status}`),
    enabled,
  })
}
