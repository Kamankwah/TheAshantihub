import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/notifications/staff-badges/ — per-tab counts of *current pending
// work* for the staff dashboard's nav badges (pending KYC submissions,
// pending listings, pending events, held escrow, …). Computed server-side
// from the live pending queues, NOT from notification rows — a badge reflects
// work still to do, and each count is gated behind the same permission that
// gates its tab (a staffer without a permission gets 0 for that key). Shape:
// { kyc, listings, events, hero, reviews, plan_approvals, contact_messages,
//   escrow }.
//
// Staff-only (403s any non-staff session), so `enabled` is passed false for
// non-staff callers — same convention as useCart.js/useNotifications.js.
// Polls on an interval so newly-arrived pending work surfaces without a
// manual reload.
export function useStaffBadges(enabled = true) {
  return useQuery({
    queryKey: ['staff-badges'],
    queryFn: () => apiFetch('/api/notifications/staff-badges/'),
    enabled,
    refetchInterval: 60000,
  })
}
