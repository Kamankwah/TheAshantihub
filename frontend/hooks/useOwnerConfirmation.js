import { useQuery } from '@tanstack/react-query'
import { apiPost } from '../apiClient.js'
import { withoutStaleSignIn } from '../lib/withoutStaleSignIn.js'

// The owner's side of the texted confirmation link. All three endpoints are POST with the token in the JSON body
// (never in a URL), public (no Authorization needed), and answer a refusal as {detail, code} with code invalid (400),
// used (409) or expired (410); 429 when throttled.
const BASE = '/api/portfolio/confirm'

// POST /confirm/preview/ {token} -> {business_name, owner_name_first, registration, items: [{kind, name, price}],
// expires_at}. It does not use the link up, so it is safe to ask again (and to retry without a stale sign-in). Never
// retried or refetched on focus, and the preview leaves the cache as soon as nothing shows it.
export function useOwnerConfirmationPreview(token) {
  return useQuery({
    queryKey: ['owner-confirmation-preview', token],
    queryFn: () => withoutStaleSignIn(() => apiPost(`${BASE}/preview/`, { token })),
    enabled: Boolean(token),
    retry: false,
    refetchOnWindowFocus: false,
    gcTime: 0,
  })
}

// POST /confirm/ {token} -> {confirmed: true}. Single use, so no automatic retry: a 401 is refused before the view
// runs, so asking once more without the stale sign-in cannot repeat the change.
export const confirmOwnerLink = (token) => withoutStaleSignIn(() => apiPost(`${BASE}/`, { token }))

// POST /confirm/decline/ {token, reason} -> {declined: true}. The reason is optional and goes to the staff who asked.
export const declineOwnerLink = (token, reason = '') => withoutStaleSignIn(() => apiPost(`${BASE}/decline/`, { token, reason }))
