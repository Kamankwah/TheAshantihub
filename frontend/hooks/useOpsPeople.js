import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch, apiPost } from '../apiClient.js'

// Operations' People screens. Each key's first element is what
// backend/realtime/publish.py sends, so a change made elsewhere refreshes them.

// GET /api/operations/scouts/?scope=team|all — the scoreboard (screen 04):
//   {scope, today, month_label, counts: {team, all},
//    totals: {registrations|visits|calls|renewals: {done, target}, visits_flagged},
//    scouts: [{id, name, areas, manager: {id, name}|null, mine, state: working|off|holiday|leave, back_on,
//      measures: {metric: {done, target|null}}, month: {done, target|null, due_by_today, on_pace, leave_cut},
//      portfolio: {size, healthy, needs_attention, at_risk, new}, check_in: {place, at, outside_radius, distance_m}|null,
//      outside_7d, fraud_case_open, report: {today: {status, due, late, is_late}, last: {date, status, is_late, similar}|null}}]}
export function useOpsScouts(scope = 'team') {
  return useQuery({
    queryKey: ['ops-scouts', scope],
    queryFn: () => apiFetch(`/api/operations/scouts/?scope=${scope}`),
    placeholderData: keepPreviousData,
  })
}

// GET /api/operations/invites/ — {pending: [{id, full_name, email, role, sent_at, expires_at,
//   state: not_opened|opened|expired, start_date, areas}], joined: [{id, full_name, role, joined_at, areas,
//   invited_by_me, invited_by}], zones: [{id, name, scouts: [first names]}], link_days}
export function useOpsInvites() {
  return useQuery({ queryKey: ['ops-invites'], queryFn: () => apiFetch('/api/operations/invites/') })
}

// GET /api/targets/plans/ — {metrics, today, limits: [{metric, min_daily, max_daily}],
//   staff: [{id, full_name, role, daily: {metric: n|null}, state, areas, joined, pending_cut: {approval_id, requested_at, metrics}|null}]}
export function useTargetPlans() {
  return useQuery({ queryKey: ['targets-plans'], queryFn: () => apiFetch('/api/targets/plans/') })
}

// POST /api/targets/plans/preview/ — before -> after per scout; a read, nothing is written.
export function useTargetsPreview(changes, effectiveFrom, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['targets-preview', effectiveFrom, changes],
    queryFn: () => apiPost('/api/targets/plans/preview/', { changes, effective_from: effectiveFrom }),
    enabled: enabled && changes.length > 0,
    placeholderData: keepPreviousData,
  })
}

// GET /api/targets/history/ — recent target changes and limit changes from the activity log.
export function useTargetsHistory() {
  return useQuery({ queryKey: ['targets-history'], queryFn: () => apiFetch('/api/targets/history/') })
}

// GET /api/targets/leave/[?from=&to=] — the team's leave (no window: ended in the last 90 days or still to come).
export function useTeamLeave(from, to) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const query = params.toString()
  return useQuery({
    queryKey: ['team-leave', from ?? null, to ?? null],
    queryFn: () => apiFetch(`/api/targets/leave/${query ? `?${query}` : ''}`),
    placeholderData: keepPreviousData,
  })
}

// GET /api/targets/holidays/?year= — public holidays on their observed dates.
export function useHolidays(year) {
  return useQuery({ queryKey: ['holidays', year], queryFn: () => apiFetch(`/api/targets/holidays/?year=${year}`), staleTime: 5 * 60 * 1000 })
}

// GET /api/targets/leave/preview/?staff=&start=&end= — working days a leave would cover.
export function useLeavePreview(staff, start, end) {
  return useQuery({
    queryKey: ['leave-preview', staff, start, end],
    queryFn: () => apiFetch(`/api/targets/leave/preview/?staff=${staff}&start=${start}&end=${end}`),
    enabled: Boolean(staff && start && end && end >= start),
  })
}

// GET /api/operations/overview/?period=today|week|month — the Operations overview (screen 01):
//   {period, today, scout_count, month_label,
//    kpis: {registrations: {done, target|null, planned}, activations: {count, registered},
//      approvals: {waiting, oldest: {title, target_label, created_at}|null},
//      checked_in: {count, working, on_leave: [names], flagged},
//      at_risk: {count, needs_attention}, issues: {total, fraud, support|null, delivery|null}},
//    scouts: [the scoreboard rows, see useOpsScouts], totals,
//    waiting: [{id, title, kind, target_label, maker, created_at, due_at, next_move: {label, at}|null}],
//    issues: [{id, type, kind_label, business, business_id, what, account_manager, opened_at, open_seconds}], issue_total}
export function useOpsOverview(period = 'today') {
  return useQuery({
    queryKey: ['ops-overview', period],
    queryFn: () => apiFetch(`/api/operations/overview/?period=${period}`),
    placeholderData: keepPreviousData,
  })
}

// Operations' Service screens (16, 17, 05), all read-only. Keys match backend/realtime/publish.py.
// GET /api/operations/service-issues/?type=contact|dispute|chat&manager=<id>&status=open|resolved —
//   {issues: [{key, type, type_label, id, business, business_id, account_manager, account_manager_id, what, detail, from,
//      handled_by, opened_at, open_seconds, status, resolved_at}], open_total, counts: {contact, dispute, chat},
//      resolved_this_week, managers: [{id, name}]}
export function useServiceIssues({ type = 'all', manager = '', status = 'open' } = {}) {
  const params = new URLSearchParams({ status })
  if (type !== 'all') params.set('type', type)
  if (manager) params.set('manager', manager)
  return useQuery({
    queryKey: ['service-issues', type, manager, status],
    queryFn: () => apiFetch(`/api/operations/service-issues/?${params}`),
    placeholderData: keepPreviousData,
  })
}

// GET /api/operations/deliveries/ — {today, assignments: [{id, order_id, businesses: [{id, name}], to, rider, status,
//   status_label, delivery_status, delivery_status_label, last_update, last_update_label}], assignments_total,
//   assigned_today, disputes: [{id, order_id, businesses, reason, status, status_label, description, raised_by,
//   handled_by, opened_at, open_seconds}], dispute_total, delivery_status_choices: [{value, label}]}
export function useDeliveries() {
  return useQuery({ queryKey: ['ops-deliveries'], queryFn: () => apiFetch('/api/operations/deliveries/') })
}

// GET /api/operations/support-team/ — {agents: [{id, name, suspended, last_sign_in_at, calls_today, report_today,
//   last_report: {date, status}|null}], queue: {open, awaiting_reply, oldest_waiting_seconds|null, closed_this_week,
//   closed_total, by_starter: {customers, business_owners, guests}}}
export function useSupportTeam() {
  return useQuery({ queryKey: ['ops-support-team'], queryFn: () => apiFetch('/api/operations/support-team/') })
}

// GET /api/listings/zones/summary/ — the Zones screen (25):
//   {zones: [{id, name, listings, businesses, scouts: [names]}], changes: [{id, what, who, at, mine}]}
// "scouts" is derived from the zones each scout's businesses sit in, not an assignment.
export function useZonesSummary() {
  return useQuery({ queryKey: ['zones-summary'], queryFn: () => apiFetch('/api/listings/zones/summary/') })
}

// GET /api/core/site-settings/history/ — [{id, at, who, changes: [{field, label, before, after}]}]; only recorded saves.
export function useSiteSettingsHistory() {
  return useQuery({ queryKey: ['site-settings-history'], queryFn: () => apiFetch('/api/core/site-settings/history/') })
}
