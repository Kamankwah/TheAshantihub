import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch('/api/listings/categories/'),
  })
}
