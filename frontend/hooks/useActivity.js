import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/activity/ — a DRF page ({count, next, previous, results}); read
// data?.results. The server scopes it to what this staffer may see.
export function useActivity(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
  return useQuery({ queryKey: ['activity', query], queryFn: () => apiFetch(`/api/activity/${query ? `?${query}` : ''}`) })
}
