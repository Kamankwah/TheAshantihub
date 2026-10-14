import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/cart/guard/?listing= (backend cart/guard.py): the delivery limits for the signed-in customer's cart — its
// shops, whether checkout is blocked and why, and (with a listing id) whether that listing may be added now. The
// server decides; screens only show what it says.
export function useCartGuard(listingId = null, { enabled = true } = {}) {
  const path = listingId != null ? `/api/cart/guard/?listing=${encodeURIComponent(listingId)}` : '/api/cart/guard/'
  return useQuery({ queryKey: ['cart-guard', listingId], queryFn: () => apiFetch(path), enabled })
}
