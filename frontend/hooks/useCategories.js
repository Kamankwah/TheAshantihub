import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// The flat public category list (GET /api/listings/categories/). `enabled: false` holds the request until a caller
// needs it (the Profile categories card waits for the business's kind).
export function useCategories({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch('/api/listings/categories/'),
    enabled,
  })
}
