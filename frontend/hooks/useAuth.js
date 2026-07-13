import { useCallback, useEffect, useState } from 'react'
import { apiFetch, apiPatch, apiPatchForm, apiPost, apiPostForm, getStoredAuth, setStoredAuth } from '../apiClient.js'

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
    const me = await apiFetch('/api/accounts/me/')
    const merged = { ...data, ...me }
    setStoredAuth(merged)
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

  const acceptBusinessTerms = useCallback(async () => {
    return apiPost('/api/accounts/business-owners/me/terms/', {})
  }, [])

  const refreshUser = useCallback(async () => {
    const me = await apiFetch('/api/accounts/me/')
    setUser((current) => (current ? { ...current, ...me } : current))
    return me
  }, [])

  const hasPermission = useCallback(
    (codename) => user?.permissions?.includes(codename) ?? false,
    [user],
  )

  return {
    user, isLoading, login, logout, registerCustomer, registerBusinessOwner,
    submitBusinessInfo, submitPayoutInfo, acceptBusinessTerms, refreshUser,
    hasPermission,
  }
}
