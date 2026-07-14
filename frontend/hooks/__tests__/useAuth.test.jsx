import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { setStoredAuth } from '../../apiClient.js'
import { useAuth } from '../useAuth.js'

afterEach(() => setStoredAuth(null))

describe('useAuth', () => {
  it('starts with no user and isLoading false when nothing is stored', async () => {
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.user).toBeNull()
  })

  it('hydrates the user from a stored token, validated against /me/', async () => {
    setStoredAuth({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
    server.use(
      http.get('http://localhost:8000/api/accounts/me/', () => {
        return HttpResponse.json({ account_type: 'customer', id: 1, full_name: 'Ama' })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.user).toEqual({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
  })

  it('clears a stored token that /me/ rejects', async () => {
    setStoredAuth({ token: 'expired', account_type: 'customer', id: 1, full_name: 'Ama' })
    server.use(
      http.get('http://localhost:8000/api/accounts/me/', () => new HttpResponse(null, { status: 401 })),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.user).toBeNull()
  })

  it('login stores and returns the authenticated user', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/customers/login/', () => {
        return HttpResponse.json({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
      }),
      http.get('http://localhost:8000/api/accounts/me/', () => {
        return HttpResponse.json({ account_type: 'customer', id: 1, full_name: 'Ama' })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.login('customer', '+233241234567', 'secret')
    })
    expect(result.current.user).toEqual({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
  })

  it('login merges /me/ into the stored user, populating registration_step for a business owner', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/business-owners/login/', () => {
        return HttpResponse.json({ token: 'biztoken', account_type: 'business_owner', id: 9, full_name: 'Abena Boateng' })
      }),
      http.get('http://localhost:8000/api/accounts/me/', () => {
        return HttpResponse.json({
          account_type: 'business_owner', id: 9, full_name: 'Abena Boateng',
          kyc_status: 'pending', kyc_rejection_reason: null, registration_step: 'business_info',
        })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.login('business_owner', '+233245551122', 'secret')
    })
    expect(result.current.user).toEqual({
      token: 'biztoken', account_type: 'business_owner', id: 9, full_name: 'Abena Boateng',
      kyc_status: 'pending', kyc_rejection_reason: null, registration_step: 'business_info',
    })
  })

  it('logout clears the user', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/customers/login/', () => {
        return HttpResponse.json({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
      }),
      http.get('http://localhost:8000/api/accounts/me/', () => {
        return HttpResponse.json({ account_type: 'customer', id: 1, full_name: 'Ama' })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.login('customer', '+233241234567', 'secret')
    })
    act(() => result.current.logout())
    expect(result.current.user).toBeNull()
  })

  it('registerCustomer stores the returned token under account_type customer', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/customers/register/', () => {
        return HttpResponse.json({ id: 5, full_name: 'Kofi Mensah', phone: '+233201112233', token: 'newtoken' }, { status: 201 })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.registerCustomer({ full_name: 'Kofi Mensah', phone: '+233201112233', password: 'secretpass' })
    })
    expect(result.current.user).toEqual({ token: 'newtoken', account_type: 'customer', id: 5, full_name: 'Kofi Mensah' })
  })

  it('registerBusinessOwner posts as JSON and stores a business_info registration step', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/business-owners/register/', async ({ request }) => {
        const body = await request.json()
        expect(body).toEqual({ full_name: 'Abena Boateng', login_phone: '+233245551122', password: 'secretpass' })
        return HttpResponse.json({ id: 9, full_name: 'Abena Boateng', login_phone: '+233245551122', kyc_status: 'pending', token: 'biztoken' }, { status: 201 })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.registerBusinessOwner({ full_name: 'Abena Boateng', login_phone: '+233245551122', password: 'secretpass' })
    })
    expect(result.current.user).toEqual({
      token: 'biztoken', account_type: 'business_owner', id: 9, full_name: 'Abena Boateng',
      kyc_status: 'pending', registration_step: 'business_info',
    })
  })

  it('submitBusinessInfo patches business-owners/me/profile/ as multipart/form-data', async () => {
    server.use(
      http.patch('http://localhost:8000/api/accounts/business-owners/me/profile/', async ({ request }) => {
        const formData = await request.formData()
        expect(formData.get('gps_address')).toBe('AK-039-5028')
        return HttpResponse.json({ gps_address: 'AK-039-5028' })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.submitBusinessInfo({ gps_address: 'AK-039-5028' })
    })
  })

  it('submitPayoutInfo patches business-owners/me/payout/ as JSON', async () => {
    server.use(
      http.patch('http://localhost:8000/api/accounts/business-owners/me/payout/', async ({ request }) => {
        const body = await request.json()
        expect(body).toEqual({ default_payout_method: 'momo', payout_momo_number: '+233201112233' })
        return HttpResponse.json({ default_payout_method: 'momo' })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.submitPayoutInfo({ default_payout_method: 'momo', payout_momo_number: '+233201112233' })
    })
  })

  it('acceptBusinessTerms posts to business-owners/me/terms/ and returns the registration step', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/business-owners/me/terms/', () => {
        return HttpResponse.json({ registration_step: 'complete' })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    let response
    await act(async () => {
      response = await result.current.acceptBusinessTerms()
    })
    expect(response).toEqual({ registration_step: 'complete' })
  })

  it('refreshUser re-fetches /me/ and merges the result into the current user', async () => {
    setStoredAuth({ token: 'biztoken', account_type: 'business_owner', id: 9, full_name: 'Abena Boateng' })
    server.use(
      http.get('http://localhost:8000/api/accounts/me/', () => {
        return HttpResponse.json({
          account_type: 'business_owner', id: 9, full_name: 'Abena Boateng',
          kyc_status: 'pending', kyc_rejection_reason: null, registration_step: 'complete',
        })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.refreshUser()
    })
    expect(result.current.user.registration_step).toBe('complete')
  })
})

describe('hasPermission', () => {
  it('returns true when the logged-in user holds the permission', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/staff/login/', () => {
        return HttpResponse.json({
          token: 't', account_type: 'staff', id: 1, full_name: 'Akosua Support',
          role: 'support', permissions: ['messaging.manage', 'disputes.flag', 'users.view'],
        })
      }),
      http.get('http://localhost:8000/api/accounts/me/', () => {
        return HttpResponse.json({
          account_type: 'staff', id: 1, full_name: 'Akosua Support',
          role: 'support', permissions: ['messaging.manage', 'disputes.flag', 'users.view'],
        })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.login('staff', 'akosua@example.com', 'secret')
    })
    expect(result.current.hasPermission('messaging.manage')).toBe(true)
    expect(result.current.hasPermission('kyc.approve')).toBe(false)
  })

  it('returns false when there is no logged-in user', async () => {
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.hasPermission('messaging.manage')).toBe(false)
  })

  it('returns false for a customer user that has no permissions field', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/customers/login/', () => {
        return HttpResponse.json({ token: 't', account_type: 'customer', id: 1, full_name: 'Ama' })
      }),
      http.get('http://localhost:8000/api/accounts/me/', () => {
        return HttpResponse.json({ account_type: 'customer', id: 1, full_name: 'Ama' })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.login('customer', '+233241234567', 'secret')
    })
    expect(result.current.hasPermission('messaging.manage')).toBe(false)
  })
})
