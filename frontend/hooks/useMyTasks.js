import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/tasks/?view= — the signed-in staffer's own tasks, a plain array
// (not a DRF page). view: open | today | overdue | upcoming | done, or
// due_today (from now to midnight, so it never overlaps overdue). Each row also
// says its kind (subscription_overdue | delivery_problem | returned_approval |
// call_follow_up | prospect_follow_up | ops_follow_up | manual), the business
// {id, name} and prospect {id, name} it is about, order_id, and, for a
// subscription task, overdue {day, pause_enabled, hide_on, grace_days}.
export function useMyTasks(view = 'open') {
  return useQuery({ queryKey: ['my-tasks', view], queryFn: () => apiFetch(`/api/tasks/?view=${view}`) })
}
