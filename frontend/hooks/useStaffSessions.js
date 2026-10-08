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
