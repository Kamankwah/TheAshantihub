import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/targets/me/?period=day|week|month[&date=YYYY-MM-DD] — the caller's
// own targets and what they have done, all from the server:
//   {label, start, end, today, working_days, leave_days, holiday_days, has_targets,
//    measures: [{metric, label, how, done, target|null, today_done|null, today_target|null}],
//    days: [{date, state: done|today|ahead|leave|holiday, holiday?}]   (non-working weekdays are left out)
//    daily: [{metric, label, value|null}], set_by, effective_from, sunday_off,
//    leave: [{start, end, kind, recorded_by}], holidays: [{date, name}], lead: {id, name}|null}
// A `target` of null means none was set ("No target set"), never zero. The
// key's first element is the one live updates publish ("my-targets").
export function useTargets(period = 'week', date, { enabled = true } = {}) {
  const params = new URLSearchParams({ period })
  if (date) params.set('date', date)
  return useQuery({
    queryKey: ['my-targets', period, date ?? null],
    queryFn: () => apiFetch(`/api/targets/me/?${params.toString()}`),
    placeholderData: keepPreviousData,
    enabled,
  })
}
