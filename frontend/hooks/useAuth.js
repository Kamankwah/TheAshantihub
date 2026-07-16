import { useCallback, useEffect, useState } from 'react'
import { apiFetch, apiPatch, apiPatchForm, apiPost, getStoredAuth, setStoredAuth } from '../apiClient.js'

const LOGIN_PATHS = {
  customer: '/api/accounts/customers/login/',
  business_owner: '/api/accounts/business-owners/login/',
  staff: '/api/accounts/staff/login/',
}

export function useAuth() {
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const stored = getStoredAuth()
    if (!stored) {
      setIsLoading(false)
      return
    }
    apiFetch('/api/accounts/me/')
      .then((me) => setUser({ ...stored, ...me }))
      .catch(() => {
        setStoredAuth(null)
        setUser(null)
      })
      .finally(() => setIsLoading(false))
  }, [])

  const login = useCallback(async (accountType, identifier, password) => {
    const data = await apiPost(LOGIN_PATHS[accountType], { identifier, password })
    setStoredAuth(data)
    let merged = data
    try {
      const me = await apiFetch('/api/accounts/me/')
      merged = { ...data, ...me }
      setStoredAuth(merged)
    } catch {
      // /me/ failed after a successful login — keep the user logged in with
      // what the login response gave us; the next page load's session-restore
      // effect will retry /me/ and fill in the rest.
    }
    setUser(merged)
    return merged
  }, [])

  const logout = useCallback(() => {
    setStoredAuth(null)
    setUser(null)
  }, [])

  const registerCustomer = useCallback(async (fields) => {
    const data = await apiPost('/api/accounts/customers/register/', fields)
    const auth = { token: data.token, account_type: 'customer', id: data.id, full_name: data.full_name }
    setStoredAuth(auth)
    setUser(auth)
    return auth
  }, [])

  const registerBusinessOwner = useCallback(async (fields) => {
    const data = await apiPost('/api/accounts/business-owners/register/', fields)
    const auth = {
      token: data.token, account_type: 'business_owner', id: data.id, full_name: data.full_name,
      kyc_status: data.kyc_status, registration_step: 'business_info',
    }
    setStoredAuth(auth)
    setUser(auth)
    return auth
  }, [])

  const submitBusinessInfo = useCallback(async (fields) => {
    const formData = new FormData()
    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') formData.append(key, value)
    })
    return apiPatchForm('/api/accounts/business-owners/me/profile/', formData)
  }, [])

  const submitPayoutInfo = useCallback(async (fields) => {
    return apiPatch('/api/accounts/business-owners/me/payout/', fields)
  }, [])

  const submitPlanSelection = useCallback(async (fields) => {
    return apiPost('/api/billing/subscriptions/start-trial/', fields)
  }, [])

  // Customer profile self-edit — full_name/avatar/address/gender/
  // date_of_birth/email_notifications_enabled/sms_notifications_enabled.
  // Primary email/phone are the account's login identifiers with no
  // verification/OTP flow for changing them, so they stay out of this
  // endpoint (read-only, surfaced via refreshUser()'s /me/ call instead).
  // Secondary/recovery email+phone go through their own request/confirm
  // endpoints below, not this one. Mirrors submitBusinessInfo's FormData-
  // building convention exactly; callers follow up with refreshUser() the
  // same way submitBusinessInfo callers already do (see
  // BusinessRegistrationFlow.jsx).
  const updateProfile = useCallback(async (fields) => {
    const formData = new FormData()
    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') formData.append(key, value)
    })
    return apiPatchForm('/api/accounts/customers/me/profile/', formData)
  }, [])

  // Secondary/recovery email + phone verification (user_account_dashboard
  // work) — each a request/confirm pair. The request call sets the pending
  // value and returns `demo_code` directly in its response: there is no real
  // email/SMS transport anywhere in this app (same "simulated" pattern as
  // MoMoPayment), so the code can't actually be delivered — it's shown to
  // the user in the UI instead of silently vanishing into a fake "sent"
  // state.
  const requestSecondaryEmail = useCallback(async (secondary_email) => {
    return apiPost('/api/accounts/customers/me/secondary-email/', { secondary_email })
  }, [])

  const confirmSecondaryEmail = useCallback(async (code) => {
    return apiPost('/api/accounts/customers/me/secondary-email/confirm/', { code })
  }, [])

  const requestSecondaryPhone = useCallback(async (secondary_phone) => {
    return apiPost('/api/accounts/customers/me/secondary-phone/', { secondary_phone })
  }, [])

  const confirmSecondaryPhone = useCallback(async (code) => {
    return apiPost('/api/accounts/customers/me/secondary-phone/confirm/', { code })
  }, [])

  const acceptBusinessTerms = useCallback(async () => {
    return apiPost('/api/accounts/business-owners/me/terms/', {})
  }, [])

  const refreshUser = useCallback(async () => {
    const me = await apiFetch('/api/accounts/me/')
    setUser((current) => {
      if (!current) return current
      const merged = { ...current, ...me }
      setStoredAuth(merged)
      return merged
    })
    return me
  }, [])

  const hasPermission = useCallback(
    (codename) => user?.permissions?.includes(codename) ?? false,
    [user],
  )

  return {
    user, isLoading, login, logout, registerCustomer, registerBusinessOwner,
    submitBusinessInfo, submitPayoutInfo, submitPlanSelection, acceptBusinessTerms, refreshUser,
    updateProfile, hasPermission,
    requestSecondaryEmail, confirmSecondaryEmail, requestSecondaryPhone, confirmSecondaryPhone,
  }
}
