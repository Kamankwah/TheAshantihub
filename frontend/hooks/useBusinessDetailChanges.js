import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/accounts/business-owners/me/detail-changes/ — the signed-in business's requests to change its owner
// name, sign-in phone or email, newest first (contacts already masked by the server). The endpoint answers
// {results: [...]}; this returns the plain array. Request and withdraw are plain apiPost calls in the component.
export function useBusinessDetailChanges({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['business-detail-changes'],
    queryFn: async () => {
      const body = await apiFetch('/api/accounts/business-owners/me/detail-changes/')
      return Array.isArray(body) ? body : body?.results ?? []
    },
    enabled,
  })
}
