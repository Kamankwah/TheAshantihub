import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/accounts/staff/sessions/ — my sessions (newest first), a plain array.
export function useMySessions() {
  return useQuery({ queryKey: ['my-sessions'], queryFn: () => apiFetch('/api/accounts/staff/sessions/') })
}

// GET /api/accounts/staff/sessions/active/ — everyone signed in now (staff.manage), a plain array.
export function useActiveSessions() {
  return useQuery({ queryKey: ['active-sessions'], queryFn: () => apiFetch('/api/accounts/staff/sessions/active/') })
}

// GET /api/accounts/staff/sessions/?staff=<id> — one person's sign-in history
// (everything the server keeps, 90 days; staff.manage). The key sits under
// ['my-sessions'] so invalidating that refreshes it too.
export function useStaffSessionHistory(staffId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['my-sessions', 'staff', staffId],
    queryFn: () => apiFetch(`/api/accounts/staff/sessions/?staff=${staffId}`),
    enabled,
  })
}
