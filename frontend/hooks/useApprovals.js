import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/approvals/?box= — a DRF page; read data?.results.
// box: mine | made | team | decided | all (all = Super Admin only).
export function useApprovals(box = 'mine', status = '') {
  const query = new URLSearchParams(Object.entries({ box, status }).filter(([, v]) => v)).toString()
  return useQuery({ queryKey: ['approvals', box, status], queryFn: () => apiFetch(`/api/approvals/?${query}`) })
}

// GET /api/approvals/counts/ — {mine, made, team, decided, can_view_all}.
export function useApprovalCounts() {
  return useQuery({ queryKey: ['approval-counts'], queryFn: () => apiFetch('/api/approvals/counts/') })
}

// GET /api/approvals/<id>/ — one request with its before/after diff.
export function useApproval(id) {
  return useQuery({
    queryKey: ['approval', String(id)],
    queryFn: () => apiFetch(`/api/approvals/${id}/`),
    enabled: id != null,
  })
}
