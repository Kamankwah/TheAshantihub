import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useModerationQueue() {
  return useQuery({
    queryKey: ['moderation-queue'],
    queryFn: () => apiFetch('/api/listings/moderation/pending/'),
  })
}
