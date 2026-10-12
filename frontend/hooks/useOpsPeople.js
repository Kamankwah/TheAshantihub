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
