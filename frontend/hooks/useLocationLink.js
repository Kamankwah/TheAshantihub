import { useQuery } from '@tanstack/react-query'
import { apiPostPublic } from '../apiClient.js'

// The owner's side of the texted "share my shop location" link. Both endpoints are POST with the token in the JSON
// body (never in a URL), public, and answer a refusal as {detail, code}: invalid (400), used / expired / revoked /
// closed (410), or a field-keyed 400 ({accuracy_m: [..]} / {lat: [..]}) for a fix the server will not take; 429 when
// throttled. They go through apiPostPublic: no stored sign-in and no view-as headers.
const BASE = '/api/accounts/location-links'

// POST /location-links/preview/ {token} -> {business_name, valid, expires_at}. It does not use the link up. The token
// is a bearer secret, so it is never part of the query key: the key is constant and the token travels only in the
// closure (one page holds one link). Never retried or refetched on focus; the preview leaves the cache at once.
export function useLocationLinkPreview(token) {
  return useQuery({
    queryKey: ['location-link-preview'],
    queryFn: () => apiPostPublic(`${BASE}/preview/`, { token }),
    enabled: Boolean(token),
    retry: false,
    refetchOnWindowFocus: false,
    gcTime: 0,
  })
}

// POST /location-links/capture/ {token, lat, lng, accuracy_m} -> {business_name, accuracy_m, captured_at}. Single use,
// so never retried automatically: the caller sends one fix per tap.
export const captureLocation = (token, { lat, lng, accuracy_m }) =>
  apiPostPublic(`${BASE}/capture/`, { token, lat, lng, accuracy_m })
