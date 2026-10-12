import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/tasks/?view= — the signed-in staffer's own tasks, a plain array
// (not a DRF page). view: open | today | overdue | upcoming | done, or
// due_today (from now to midnight, so it never overlaps overdue). Each row also
// says its kind (subscription_overdue | delivery_problem | returned_approval |
// call_follow_up | prospect_follow_up | ops_follow_up | manual), the business
// {id, name} and prospect {id, name} it is about, order_id, and, for a
// subscription task, overdue {day, pause_enabled, hide_on, grace_days}.
// scope 'team' asks for my direct reports' tasks instead (each row also carries owner {id, name}).
export function useMyTasks(view = 'open', scope = 'mine') {
  return useQuery({
    queryKey: ['my-tasks', view, scope],
    queryFn: () => apiFetch(`/api/tasks/?view=${view}${scope === 'team' ? '&scope=team' : ''}`),
  })
}

// GET /api/tasks/team-summary/ — [{id, name, role, overdue, oldest_days|null, state: working|off|holiday|leave}], most overdue first.
export function useTeamTaskSummary({ enabled = true } = {}) {
  return useQuery({ queryKey: ['my-tasks', 'team-summary'], queryFn: () => apiFetch('/api/tasks/team-summary/'), enabled })
}
