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
export function useEscrowLedger({ status } = {}) {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  const qs = params.toString()
  return useQuery({
    queryKey: ['escrow-ledger', status ?? null],
    queryFn: () => apiFetch(`/api/events/tickets/escrow/${qs ? `?${qs}` : ''}`),
  })
}
