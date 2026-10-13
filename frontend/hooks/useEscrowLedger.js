import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/events/tickets/escrow/ — staff-only (escrow.view), paginated
// ({count, next, previous, results} — same gotcha as
// useReviewsModerationQueue.js, callers must read `data?.results`, not
// `data` directly) ledger of every ticket's escrow state
// (TicketEscrowLedgerSerializer). Optional `status` ("held"|"released")
// filter, forwarded as `?status=`, per the backend's optional query param —
// not required by any current caller, but convenient for a future filtered
// view.
// `enabled` (default true) — see hooks/useKYCQueue.js's identical
// convention, used the same way by OverviewPanel (gating on escrow.view||
// escrow.release||escrow.refund).
// The Accountant's screen adds `state` ("held"|"released"|"refunded"), `q` (code, event or
// buyer) and `page`.
export function useEscrowLedger({ status, state, q, page, enabled = true } = {}) {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (state) params.set('state', state)
  if (q) params.set('q', q)
  if (page && page > 1) params.set('page', String(page))
  const qs = params.toString()
  return useQuery({
    queryKey: ['escrow-ledger', status ?? null, state ?? null, q ?? null, page ?? 1],
    queryFn: () => apiFetch(`/api/events/tickets/escrow/${qs ? `?${qs}` : ''}`),
    enabled,
  })
}

// GET /api/events/tickets/escrow/summary/ — ticket money by state (escrow.view).
export function useEscrowSummary({ enabled = true } = {}) {
  return useQuery({ queryKey: ['escrow-ledger', 'summary'], queryFn: () => apiFetch('/api/events/tickets/escrow/summary/'), enabled })
}
