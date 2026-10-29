// Public site settings (GET /api/core/site-settings/): contact details, social links, policies and
// `pickup_office_address` (the AshantiHub store-pickup office; "" until a Super Admin sets it, never guessed).
// A single object, not paginated.
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useSiteSettings() {
  return useQuery({
    queryKey: ['site-settings'],
    queryFn: () => apiFetch('/api/core/site-settings/'),
  })
}
