import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'
import { retryUnlessLedgerOff } from './useWallet.js'

// Both queues are PAGINATED (DRF envelope {count, next, previous, results}, 20 a page): read `data?.results` and
// `count`. Both need orders.verify, carry the customer's full phone, and answer 409 {code:"ledger_off"} while the
// ledger is off. Keys start with 'ledger-verification' so the live-update row refreshes them.

// GET /api/ledger/orders/awaiting-verification/?page= — order_id, placed_at, due_by, overdue, delivery_method,
// customer_name, customer_phone, items [{name, quantity, business}], customer_confirmed, outcome, outcome_note, released.
export function useOrdersAwaitingCall({ page = 1 } = {}) {
  return useQuery({
    queryKey: ['ledger-verification', 'orders', page],
    queryFn: () => apiFetch(`/api/ledger/orders/awaiting-verification/?page=${page}`),
    retry: retryUnlessLedgerOff,
    refetchOnWindowFocus: true,
  })
}

// GET /api/ledger/bookings/awaiting-verification/?page= — sale_id, kind (service|stay|tickets), label, what, paid_at,
// handed_over_at, due_by, overdue, business, customer_name, customer_phone, amount (GH₵ string), customer_confirmed,
// outcome, outcome_note, dispute_id.
export function useBookingsAwaitingCall({ page = 1 } = {}) {
  return useQuery({
    queryKey: ['ledger-verification', 'bookings', page],
    queryFn: () => apiFetch(`/api/ledger/bookings/awaiting-verification/?page=${page}`),
    retry: retryUnlessLedgerOff,
    refetchOnWindowFocus: true,
  })
}

// GET /api/ledger/bookings/?q= — Support's booking search (orders.support_update). NOT paginated: it answers
// {results} (newest paid first, at most 20), so read `data?.results`. Each row: sale_id, kind, what, paid_at, business,
// customer_name, customer_phone (MASKED, "024 *** 5531"), amount (GH₵ string), handed_over_at, cancellable,
// release_at. 409 {code:"ledger_off"} while the ledger is off. Same key prefix as the queues, so Refresh covers it.
export function useBookingLookup(q = '') {
  const term = q.trim()
  return useQuery({
    queryKey: ['ledger-verification', 'lookup', term],
    queryFn: () => apiFetch(`/api/ledger/bookings/?q=${encodeURIComponent(term)}`),
    retry: retryUnlessLedgerOff,
    refetchOnWindowFocus: true,
  })
}
