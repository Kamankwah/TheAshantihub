import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/disputes/<id>/ — one dispute with its evidence and the records that
// attach themselves (disputes.flag or disputes.resolve_financial).
export function useDispute(id) {
  return useQuery({
    queryKey: ['disputes-queue', 'detail', id],
    queryFn: () => apiFetch(`/api/disputes/${id}/`),
    enabled: Boolean(id),
  })
}

// GET /api/disputes/counts/ — {needs_intake, with_accounting, decided_this_week}.
export function useDisputeCounts() {
  return useQuery({
    queryKey: ['disputes-queue', 'counts'],
    queryFn: () => apiFetch('/api/disputes/counts/'),
  })
}
