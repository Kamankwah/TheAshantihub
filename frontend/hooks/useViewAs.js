import { useQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { apiFetch, apiPost, getStoredAuth } from '../apiClient.js'
import { clearViewAs, getViewAsSnapshot, setViewAs, setViewAsLive, subscribeViewAs, viewFor } from '../lib/viewAs.js'

// The view this tab is stepped into for the current sign-in, or null
// (lib/viewAs.js; the server rules are in backend/accounts/view_as.py).
export function useViewAs() {
  const snapshot = useSyncExternalStore(subscribeViewAs, getViewAsSnapshot)
  return snapshot && viewFor(getStoredAuth()?.token) === snapshot ? snapshot : null
}

// GET /api/accounts/staff/view-as/ (always as the Super Admin): who can be
// opened, by team, and the view this session is in now. Super Admin only.
export function useStepInPeople(enabled = true) {
  return useQuery({
    queryKey: ['view-as-people'],
    queryFn: () => apiFetch('/api/accounts/staff/view-as/'),
    enabled,
    staleTime: 60000,
  })
}

// Start (or switch to) a view of `person`; the server records it.
export async function startViewAs(person) {
  const { current } = await apiPost('/api/accounts/staff/view-as/', { staff: person.id })
  setViewAs(current?.staff || person, getStoredAuth()?.token, current?.started_at)
  return current
}

// Leave the view: requests stop carrying X-View-As at once (so whatever
// follows, a sign-out included, goes as the Super Admin), the server records
// the end, then the Super Admin's own shell comes back.
export async function endViewAs() {
  setViewAsLive(false)
  try {
    await apiPost('/api/accounts/staff/view-as/end/', {})
  } catch {
    // The session may already be over (it ended or idled out): nothing to record.
  }
  clearViewAs()
}
