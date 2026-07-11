import { useCallback, useEffect, useState } from 'react'
import { apiFetch, apiPost, apiPostForm, getStoredAuth, setStoredAuth } from '../apiClient.js'

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
    setUser(data)
    return data
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
    const formData = new FormData()
    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') formData.append(key, value)
    })
    const data = await apiPostForm('/api/accounts/business-owners/register/', formData)
    const auth = { token: data.token, account_type: 'business_owner', id: data.id, full_name: data.full_name }
    setStoredAuth(auth)
    setUser(auth)
    return auth
  }, [])

  const hasPermission = useCallback(
    (codename) => user?.permissions?.includes(codename) ?? false,
    [user],
  )

  return { user, isLoading, login, logout, registerCustomer, registerBusinessOwner, hasPermission }
}
