import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/tasks/?view= — the signed-in staffer's own tasks, a plain array
// (not a DRF page). view: open | today | overdue | upcoming | done.
export function useMyTasks(view = 'open') {
  return useQuery({ queryKey: ['my-tasks', view], queryFn: () => apiFetch(`/api/tasks/?view=${view}`) })
}
