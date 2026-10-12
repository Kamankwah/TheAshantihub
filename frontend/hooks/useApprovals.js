import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/approvals/?box= — a DRF page; read data?.results.
// box: mine | made | team | decided | all (all = Super Admin only).
// filters (all optional): kind, maker, min_wait_hours, escalated ("1"), ordering (due | newest | decided).
export function useApprovals(box = 'mine', status = '', filters = {}) {
  const query = new URLSearchParams(Object.entries({ box, status, ...filters }).filter(([, v]) => v)).toString()
  return useQuery({ queryKey: ['approvals', box, status, query], queryFn: () => apiFetch(`/api/approvals/?${query}`) })
}

// GET /api/approvals/counts/ — {mine, made, team, decided, escalated_to_me, makers: [{id, full_name}],
// kinds: [{key, label, response_hours}], can_view_all}.
export function useApprovalCounts() {
  return useQuery({ queryKey: ['approval-counts'], queryFn: () => apiFetch('/api/approvals/counts/') })
}

// GET /api/approvals/stats/ — {decided_today, approved_today, returned_today, median_minutes} for the viewer.
export function useApprovalStats() {
  return useQuery({ queryKey: ['approval-stats'], queryFn: () => apiFetch('/api/approvals/stats/') })
}

// GET /api/approvals/<id>/ — one request with its before/after diff.
export function useApproval(id) {
  return useQuery({
    queryKey: ['approval', String(id)],
    queryFn: () => apiFetch(`/api/approvals/${id}/`),
    enabled: id != null,
  })
}
