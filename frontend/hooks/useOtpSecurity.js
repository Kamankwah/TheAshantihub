import { useQuery } from '@tanstack/react-query'
import { apiFetch, getStoredAuth } from '../apiClient.js'

// Plain objects, no pagination. Hints only: no code, token or secret ever goes
// through these queries (setup and recovery responses stay in component state).
const signedIn = () => Boolean(getStoredAuth()?.token)

export function useSecurityOverview(enabled = true) {
  return useQuery({
    queryKey: ['otp', 'me'],
    queryFn: () => apiFetch('/api/otp/me/'),
    enabled: enabled && signedIn(),
  })
}

export function useAuthenticatorStatus(enabled = true) {
  return useQuery({
    queryKey: ['otp', 'authenticator'],
    queryFn: () => apiFetch('/api/otp/authenticator/'),
    enabled: enabled && signedIn(),
  })
}
