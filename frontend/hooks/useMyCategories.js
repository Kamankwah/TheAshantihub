import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// The signed-in business owner's categories: {business_kind, min, max, categories: [{id, label, kind}]}.
// The first category is the main one. Changing them is a plain PUT {categories: [ids]} from the caller.
export function useMyCategories(enabled = true) {
  return useQuery({
    queryKey: ['my-categories'],
    queryFn: () => apiFetch('/api/accounts/business-owners/me/categories/'),
    enabled,
  })
}
