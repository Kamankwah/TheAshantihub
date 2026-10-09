import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/fraud/flags/?status=&page= — DRF pages of 25, newest first, read
// as data.pages[n].results; fetchNextPage() asks for the page DRF's `next`
// names, so no case is hidden past the first 25. status: open | confirmed |
// dismissed. A fraud.manage holder sees every case; someone who can only
// flag (Support) sees the ones they raised. Live updates refresh every
// loaded page through the "fraud-flags" key.
export function useFraudFlags(status = 'open') {
  return useInfiniteQuery({
    queryKey: ['fraud-flags', status],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ status })
      if (pageParam) params.set('page', pageParam)
      return apiFetch(`/api/fraud/flags/?${params.toString()}`)
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => (lastPage?.next ? new URL(lastPage.next).searchParams.get('page') || undefined : undefined),
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
