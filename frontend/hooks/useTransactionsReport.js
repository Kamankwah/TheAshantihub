import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/billing/transactions/report/ — staff-only (transactions.report),
// the aggregate report: {summary:{count,total_amount}, status_breakdown,
// series:[{month:"2026-01",amount:"1234.56"}, ...]} (not a paginated
// envelope — this is a single aggregate object, unlike
// useEscrowLedger/useDisputesQueue's paginated queues). Optional
// date_from/date_to (ISO "YYYY-MM-DD") filters, forwarded as query params
// when present — same optional-filter-forwarding convention as
// useEscrowLedger({status}).
export function useTransactionsReport({ dateFrom, dateTo } = {}) {
  const params = new URLSearchParams()
  if (dateFrom) params.set('date_from', dateFrom)
  if (dateTo) params.set('date_to', dateTo)
  const qs = params.toString()
  return useQuery({
    queryKey: ['transactions-report', dateFrom ?? null, dateTo ?? null],
    queryFn: () => apiFetch(`/api/billing/transactions/report/${qs ? `?${qs}` : ''}`),
  })
}
