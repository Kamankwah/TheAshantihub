import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, apiPatch, apiPatchForm, apiPost, getStoredAuth, setStoredAuth } from '../apiClient.js'
import { getNetworkStatus, subscribeNetworkStatus } from '../lib/networkStatus.js'

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
      .catch((error) => {
        // Only an auth rejection ends the session. A network failure (no
        // `.status` — e.g. the installed staff app opened offline) or a server
        // error keeps the stored session, which already holds the last /me/
        // payload (login merges it in), so the app can render and show its
        // own offline/error states instead of silently signing the user out.
        if (error?.status === 401 || error?.status === 403) {
          setStoredAuth(null)
          setUser(null)
        } else {
          setUser(stored)
        }
      })
      .finally(() => setIsLoading(false))
  }, [])

  // Stores a sign-in response and merges /me/ into it (shared by the
  // password sign-in and the 2-step sign-in's last step).
  const completeSignIn = useCallback(async (data) => {
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

  const login = useCallback(async (accountType, identifier, password) => {
    const data = await apiPost(LOGIN_PATHS[accountType], { identifier, password })
    // A staffer with 2-step sign-in (or a Super Admin who must set it up)
    // gets a short-lived challenge instead of a token. Nothing is stored
    // until the second step succeeds.
    if (data?.two_factor_required || data?.two_factor_setup_required) return data
    return completeSignIn(data)
  }, [completeSignIn])

  const verifyTwoFactor = useCallback(async (mfaToken, { code, recoveryCode } = {}) => {
    const body = recoveryCode ? { mfa_token: mfaToken, recovery_code: recoveryCode } : { mfa_token: mfaToken, code }
    return completeSignIn(await apiPost('/api/accounts/staff/login/two-factor/', body))
  }, [completeSignIn])

  const startTwoFactorEnrolment = useCallback(
    (mfaToken) => apiPost('/api/accounts/staff/two-factor/enrol/start/', { mfa_token: mfaToken }),
    [],
  )

  // Returns the recovery codes and the sign-in payload WITHOUT signing in, so
  // the codes can be shown before the dashboard replaces the sign-in form;
  // the caller finishes with completeSignIn(login).
  const confirmTwoFactorEnrolment = useCallback(async (mfaToken, code) => {
    const { recovery_codes: recoveryCodes, ...login } = await apiPost(
      '/api/accounts/staff/two-factor/enrol/confirm/', { mfa_token: mfaToken, code },
    )
    return { recoveryCodes, login }
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

  // Staff invite activation (staff onboarding work) — the activate endpoint
  // only returns {status, token}, not a full login-response shape (no
  // account_type/full_name), so this mirrors login()'s own
  // store-token-then-merge-/me/ two-step exactly rather than inventing a
  // second auth-persistence mechanism: setStoredAuth the freshly-issued
  // token immediately (as a bare {token, account_type:'staff'} — 'staff' is
  // hardcoded since this endpoint can only ever activate a StaffUser), then
  // fetch /me/ (now authorized by that token) to fill in full_name/role/
  // permissions/etc. before setUser. Callers pass the resolved result into
  // the same onSuccess() flow AuthModal's login/signup already use, so a
  // successful activation flips AshantiHub's isAdmin exactly like a staff
  // login would.
  const activateStaff = useCallback(async (token, password) => {
    const data = await apiPost('/api/accounts/staff/activate/', { token, password })
    // A Super Admin invitee (or anyone a second step is due for) gets a
    // 2-step challenge and no token. Nothing is stored; the caller shows
    // StaffTwoStepSignIn, which finishes the sign-in.
    if (data?.two_factor_setup_required || data?.two_factor_required) return data
    setStoredAuth({ token: data.token, account_type: 'staff' })
    let merged = { token: data.token, account_type: 'staff' }
    try {
      const me = await apiFetch('/api/accounts/me/')
      merged = { ...merged, ...me }
      setStoredAuth(merged)
    } catch {
      // /me/ failed right after activation — same "keep the session, let the
      // next page load's session-restore effect retry /me/" fallback login()
      // already relies on above.
    }
    setUser(merged)
    return merged
  }, [])

  // Password reset (staff onboarding + account-recovery work) — plain
  // apiPost wrappers with no local auth-state side effects, same convention
  // as acceptBusinessTerms/submitPayoutInfo above. The request step takes
  // email only — the backend checks every account type for a match and each
  // one gets its own reset link (the emailed link carries the type, so no
  // public form ever asks the caller to declare it — a "Staff" picker on a
  // public form would advertise which account classes exist). It also
  // deliberately doesn't throw/surface "no such account" — the backend
  // always returns a generic success response regardless, so callers should
  // show the same generic copy whether or not this resolves.
  const requestPasswordReset = useCallback(async (email) => {
    return apiPost('/api/accounts/password-reset/request/', { email })
  }, [])

  const confirmPasswordReset = useCallback(async (accountType, token, password) => {
    return apiPost('/api/accounts/password-reset/confirm/', { token, account_type: accountType, password })
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

  // A session kept through an offline launch (see the restore effect) was
  // never re-validated. When connectivity comes back (offline → online in
  // lib/networkStatus.js), re-fetch /me/ so revoked permissions or a
  // deactivated account are noticed without a reload. Same rule as restore:
  // only 401/403 ends the session; network/server errors keep it. Skipped
  // while the restore itself is still in flight (it handles /me/ already).
  const isLoadingRef = useRef(isLoading)
  useEffect(() => {
    isLoadingRef.current = isLoading
  }, [isLoading])
  useEffect(() => {
    let wasOffline = getNetworkStatus().offline
    return subscribeNetworkStatus(() => {
      const { offline } = getNetworkStatus()
      const cameOnline = wasOffline && !offline
      wasOffline = offline
      if (!cameOnline || isLoadingRef.current || !getStoredAuth()) return
      refreshUser().catch((error) => {
        if (error?.status === 401 || error?.status === 403) {
          setStoredAuth(null)
          setUser(null)
        }
      })
    })
  }, [refreshUser])

  const hasPermission = useCallback(
    (codename) => user?.permissions?.includes(codename) ?? false,
    [user],
  )

  return {
    user, isLoading, login, logout, registerCustomer, registerBusinessOwner,
    submitBusinessInfo, submitPayoutInfo, submitPlanSelection, acceptBusinessTerms, refreshUser,
    updateProfile, hasPermission,
    requestSecondaryEmail, confirmSecondaryEmail, requestSecondaryPhone, confirmSecondaryPhone,
    activateStaff, requestPasswordReset, confirmPasswordReset,
    completeSignIn, verifyTwoFactor, startTwoFactorEnrolment, confirmTwoFactorEnrolment,
  }
}
