import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/fraud/flags/?status= — a DRF page (read data?.results), newest
// first, 25 a page. status: open | confirmed | dismissed. A fraud.manage
// holder sees every case; someone who can only flag (Support) sees the ones
// they raised. Live updates refresh it through the "fraud-flags" key.
export function useFraudFlags(status = 'open') {
  return useQuery({
    queryKey: ['fraud-flags', status],
    queryFn: () => apiFetch(`/api/fraud/flags/?status=${encodeURIComponent(status)}`),
  })
}

// GET /api/fraud/flags/counts/ — {open, confirmed, dismissed} over the same
// cases the list shows the caller.
export function useFraudFlagCounts() {
  return useQuery({
    queryKey: ['fraud-flag-counts'],
    queryFn: () => apiFetch('/api/fraud/flags/counts/'),
  })
}

// GET /api/accounts/business-owners/?search= (users.view) — the "Raise a
// case" business picker. A DRF page of {id, full_name, business_name,
// login_phone, …}; asked only once at least two characters are typed.
export function useBusinessOwnerSearch(term) {
  const q = (term || '').trim()
  return useQuery({
    queryKey: ['staff-business-owners', 'search', q],
    queryFn: () => apiFetch(`/api/accounts/business-owners/?search=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  })
}
