import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/cart/ get-or-creates the caller's cart lazily — always a
// Customer-scoped resource (docs/BUSINESS_EVENTS_ROADMAP.md Phase 4).
// `enabled` lets callers (e.g. AshantiHub, for the Navbar badge count) skip
// firing this for anonymous visitors or business-owner accounts, who have no
// Cart and would just get a 401/403. Defaults to true so a component that
// only ever renders once the caller is already known to be a signed-in
// Customer (e.g. CartDrawer) doesn't need to pass anything.
export function useCart(enabled = true) {
  return useQuery({
    queryKey: ['cart'],
    queryFn: () => apiFetch('/api/cart/'),
    enabled,
  })
}
