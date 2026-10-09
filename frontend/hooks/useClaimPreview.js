import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'
import { withoutStaleSignIn } from '../lib/withoutStaleSignIn.js'

// GET /api/accounts/business-owners/claim/?token= — what an owner sees before
// setting a password (business, sign-in phone, who registered it, terms
// version, expiry). A used, replaced or expired token answers 400
// {detail, code}; a hand-over token opened on another phone answers 403. The
// token is single use, so this is never retried or refetched on focus (once
// claimed, a refetch could only say "used"), and the preview leaves the cache
// as soon as nothing shows it. publicLink (the emailed link's page): an
// expired sign-in stored in this browser doesn't stop the page — it asks once
// more without it. The scout's hand-over leaves it off: its token is bound to
// the scout's session, which every request must carry.
export function useClaimPreview(token, { publicLink = false } = {}) {
  const path = `/api/accounts/business-owners/claim/?token=${encodeURIComponent(token)}`
  return useQuery({
    queryKey: ['owner-claim-preview', token],
    queryFn: () => (publicLink ? withoutStaleSignIn(() => apiFetch(path)) : apiFetch(path)),
    enabled: Boolean(token),
    retry: false,
    refetchOnWindowFocus: false,
    gcTime: 0,
  })
}
