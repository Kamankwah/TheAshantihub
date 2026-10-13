import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/calls/counterparts/?q= — Support's "Find them": {customers: [{id, name, phone_masked, orders}],
// businesses: [{id, business_name, owner_name, phone_masked}], orders: [{id, customer_id, customer_name,
// total_amount, label}], prospects: []}. Phones arrive masked; a business is a name and a masked number only.
export function useCounterpartSearch(q) {
  const text = (q || '').trim()
  return useQuery({
    queryKey: ['call-counterparts', 'search', text],
    queryFn: () => apiFetch(`/api/calls/counterparts/?q=${encodeURIComponent(text)}`),
    enabled: text.length >= 2,
  })
}

// GET /api/messaging/staff/?q= — the conversations a call can be linked to. Where the server does not
// support the search yet the request fails or returns the plain queue; the caller shows nothing then.
export function useConversationSearch(q) {
  const text = (q || '').trim()
  return useQuery({
    queryKey: ['staff-conversation-search', text],
    queryFn: () => apiFetch(`/api/messaging/staff/?q=${encodeURIComponent(text)}`),
    enabled: text.length >= 2,
    retry: false,
  })
}
