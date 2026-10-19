import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// Staff side of the marketplace opening (Super Admin, opening.manage).
// GET /api/storefront/opening/ → {opens_at, server_now, is_open, gate_enabled}: the raw snapshot, with no
// device-clock offset (the shopper-facing useOpening hook keeps its own cache entry for the countdown).
export function useOpeningSnapshot(enabled = true) {
  return useQuery({
    queryKey: ['staff-opening'],
    queryFn: () => apiFetch('/api/storefront/opening/'),
    enabled,
  })
}

// GET /api/storefront/test-accounts/ → [{customer, customer_name, added_at}]: the customers allowed to buy before opening.
export function useTestAccounts(enabled = true) {
  return useQuery({
    queryKey: ['staff-opening-test-accounts'],
    queryFn: () => apiFetch('/api/storefront/test-accounts/'),
    enabled,
  })
}
