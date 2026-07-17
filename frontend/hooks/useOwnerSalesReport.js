import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/orders/owner/report/ — the business owner's customer-sales report
// (business item 4 / Wave I): summary + monthly series + capped rows, filtered
// by date range and product/service kind. This is SALES (money customers paid
// for the owner's listings), distinct from the owner's own outgoing spend on
// useMyTransactions.
export function useOwnerSalesReport({ dateFrom, dateTo, kind } = {}) {
  const params = new URLSearchParams()
  if (dateFrom) params.set('date_from', dateFrom)
  if (dateTo) params.set('date_to', dateTo)
  if (kind) params.set('kind', kind)
  const qs = params.toString()
  return useQuery({
    queryKey: ['owner-sales-report', dateFrom || '', dateTo || '', kind || ''],
    queryFn: () => apiFetch(`/api/orders/owner/report/${qs ? `?${qs}` : ''}`),
  })
}
