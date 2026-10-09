import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/commission/me/?page_size= — the signed-in scout's own statement.
//   {count, next, previous, results: [line],
//    statement: {from, to},
//    totals: {on_hold|payable|in_batch|paid|reversed: {amount, count, registrations, bonuses}, reversed.reasons: {label: n}},
//    bonus: [{business, business_id, paid_months, state: {kind: trial_until|overdue|next_renewal|none, date?, day?}}], bonus_more,
//    policy: {registration: {amount, effective_from}|null, three_paid_months_bonus: …|null}}
// line: {id, business, kind, kind_label, amount, status, status_label, earned_at, hold_until, reversed_reason, reversed_label, reversed_at}
// Amounts are strings of GH₵ ("50.00"). The key's first element is the one live updates publish.
export function useMyCommission(pageSize = 4, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['my-commission', pageSize],
    queryFn: () => apiFetch(`/api/commission/me/?page_size=${pageSize}`),
    placeholderData: keepPreviousData,
    enabled,
  })
}

// GET /api/commission/policies/ — {current: {registration|three_paid_months_bonus: {amount, effective_from}|null},
//   pending: [{id, kind, amount, effective_from, maker, created_at}], history: [...]}
export function useCommissionPolicies({ enabled = true } = {}) {
  return useQuery({ queryKey: ['commission-policies'], queryFn: () => apiFetch('/api/commission/policies/'), enabled })
}

// GET /api/commission/accruals/ — every staff member's lines (commission.view_all); a DRF page plus `totals`.
export function useCommissionAccruals({ enabled = true } = {}) {
  return useQuery({ queryKey: ['commission-accruals'], queryFn: () => apiFetch('/api/commission/accruals/'), enabled })
}
