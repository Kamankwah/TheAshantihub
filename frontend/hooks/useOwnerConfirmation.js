import { useQuery } from '@tanstack/react-query'
import { apiPostPublic } from '../apiClient.js'

// The owner's side of the texted confirmation link. All three endpoints are POST with the token in the JSON body
// (never in a URL), public, and answer a refusal as {detail, code} with code invalid (400),
// used (409) or expired (410); 429 when throttled. They go through apiPostPublic: no stored sign-in and no view-as
// headers (the backend views take no authentication, so a stale sign-in is never why they fail; that is also why
// withoutStaleSignIn is not used here).
const BASE = '/api/portfolio/confirm'

// POST /confirm/preview/ {token} -> {business_name, owner_name_first, registration, items: [{kind, name, price}],
// expires_at}. It does not use the link up, so it is safe to ask again. Never
// retried or refetched on focus, and the preview leaves the cache as soon as nothing shows it.
export function useOwnerConfirmationPreview(token) {
  return useQuery({
    queryKey: ['owner-confirmation-preview', token],
    queryFn: () => apiPostPublic(`${BASE}/preview/`, { token }),
    enabled: Boolean(token),
    retry: false,
    refetchOnWindowFocus: false,
    gcTime: 0,
  })
}

// POST /confirm/ {token} -> {confirmed: true}. Single use, so never retried automatically.
export const confirmOwnerLink = (token) => apiPostPublic(`${BASE}/`, { token })

// POST /confirm/decline/ {token, reason} -> {declined: true}. The reason is optional and goes to the staff who asked.
export const declineOwnerLink = (token, reason = '') => apiPostPublic(`${BASE}/decline/`, { token, reason })
