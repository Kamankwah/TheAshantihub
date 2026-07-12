import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useKYCQueue() {
  return useQuery({
    queryKey: ['kyc-queue'],
    queryFn: () => apiFetch('/api/accounts/kyc/pending/'),
  })
}
