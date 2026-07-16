import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/accounts/customers/me/profile/ — the signed-in customer's full
// self-service profile (CustomerProfileSerializer): full_name, avatar,
// read-only email/phone, address, gender, date_of_birth, secondary email/
// phone + their verified flags, and notification preferences. Distinct from
// the lightweight `user` object AshantiHub builds from GET /api/accounts/me/
// (fullName/avatar/accountType/... only) — AccountProfileCard/SettingsTab
// own this richer query themselves, same "component owns its data"
// convention as useBusinessProfile/useCart/etc.
export function useMyCustomerProfile(enabled = true) {
  return useQuery({
    queryKey: ['my-customer-profile'],
    queryFn: () => apiFetch('/api/accounts/customers/me/profile/'),
    enabled,
  })
}
