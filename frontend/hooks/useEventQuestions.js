import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/qa/questions/event/{id}/ — public, unauthenticated, paginated
// ({count, next, previous, results}).
export function useEventQuestions(id) {
  return useQuery({
    queryKey: ['event-questions', id],
    queryFn: () => apiFetch(`/api/qa/questions/event/${id}/`),
    enabled: id != null,
  })
}
