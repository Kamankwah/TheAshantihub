import { useQuery } from '@tanstack/react-query'
import { apiDelete, apiFetch, apiPost } from '../apiClient.js'

// The signed-in customer's server wishlist ("Your Lists"). GET /api/wishlist/ is a PLAIN
// ARRAY, newest first: [{ id, listing: { card row }, added_at }] - NOT a paginated envelope,
// so read `data` directly. Customers only (staff and business accounts get 403), so callers
// pass `enabled` false for everyone else. ProductPage and CartPage invalidate this same key.
// add/remove are plain apiPost/apiDelete then a refetch; they throw so the caller can show
// the server's refusal in its own actionError.
export const WISHLIST_KEY = ['wishlist']

export function useWishlist({ enabled = true } = {}) {
  const query = useQuery({
    queryKey: WISHLIST_KEY,
    queryFn: () => apiFetch('/api/wishlist/'),
    enabled,
  })
  const items = Array.isArray(query.data) ? query.data : []

  const add = async (listingId) => {
    await apiPost('/api/wishlist/', { listing: listingId })
    await query.refetch()
  }
  const remove = async (listingId) => {
    try {
      await apiDelete(`/api/wishlist/${listingId}/`)
    } catch (err) {
      // Already gone (another tab removed it): the list just needs to catch up.
      if (err?.status !== 404) throw err
    }
    await query.refetch()
  }
  return { items, add, remove, ...query }
}
