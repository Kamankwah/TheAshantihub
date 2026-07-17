import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/credit/loans/ — the staff loan-application queue (credit.manage).
// Paginated ({count, next, previous, results}) — read data?.results. Backs the
// admin Credit panel's loan-applications section (item 16).
export function useLoanApplicationsAdmin({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['loan-applications-admin'],
    queryFn: () => apiFetch('/api/credit/loans/'),
    enabled,
  })
}
