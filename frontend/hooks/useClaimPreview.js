import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/accounts/business-owners/claim/?token= — what an owner sees before
// setting a password (business, sign-in phone, who registered it, terms
// version, expiry). A used, replaced or expired token answers 400
// {detail, code}; a hand-over token opened on another phone answers 403. The
// token is single use, so this is never retried or refetched on focus (once
// claimed, a refetch could only say "used"), and the preview leaves the cache
// as soon as nothing shows it.
export function useClaimPreview(token) {
  return useQuery({
    queryKey: ['owner-claim-preview', token],
    queryFn: () => apiFetch(`/api/accounts/business-owners/claim/?token=${encodeURIComponent(token)}`),
    enabled: Boolean(token),
    retry: false,
    refetchOnWindowFocus: false,
    gcTime: 0,
  })
}
