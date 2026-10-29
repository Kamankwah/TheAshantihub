import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// The signed-in business owner's identity check: {identity_status, identity_rejection_reason,
// identity_submitted_at, is_formal, has_certificate, has_tin}. Never carries the card number or photos.
export function useMyIdentity(enabled = true) {
  return useQuery({
    queryKey: ['my-identity'],
    queryFn: () => apiFetch('/api/accounts/business-owners/me/identity/'),
    enabled,
  })
}
