import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/catalogue/staff/requests/pending/?status=&page= — a DRF envelope of
// 50 ({count, next, previous, results}). The first key element is the realtime
// key "catalogue-queue", so a staff decision elsewhere refreshes this list.
export function useCatalogueQueue({ status = 'pending', page = 1, enabled = true } = {}) {
  return useQuery({
    queryKey: ['catalogue-queue', status, page],
    queryFn: () => apiFetch(`/api/catalogue/staff/requests/pending/?status=${encodeURIComponent(status)}&page=${page}`),
    enabled,
  })
}
