import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/qa/questions/listing/{id}/ — public, unauthenticated, paginated
// ({count, next, previous, results}).
export function useListingQuestions(id) {
  return useQuery({
    queryKey: ['listing-questions', id],
    queryFn: () => apiFetch(`/api/qa/questions/listing/${id}/`),
    enabled: id != null,
  })
}
