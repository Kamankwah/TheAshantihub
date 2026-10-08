import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { setStoredAuth } from '../../apiClient.js'
import { getNetworkStatus, reportApiNetworkFailure, reportApiResponse } from '../../lib/networkStatus.js'
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

  it('keeps the stored session when /me/ fails with a network error (offline launch)', async () => {
    const stored = { token: 'abc123', account_type: 'staff', id: 1, full_name: 'Akosua', permissions: ['users.view'] }
    setStoredAuth(stored)
    server.use(http.get('http://localhost:8000/api/accounts/me/', () => HttpResponse.error()))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.user).toEqual(stored)
    expect(JSON.parse(localStorage.getItem('ashantihub.auth'))).toEqual(stored)
  })

  it('keeps the stored session when /me/ fails with a server error', async () => {
    setStoredAuth({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
    server.use(http.get('http://localhost:8000/api/accounts/me/', () => new HttpResponse(null, { status: 500 })))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.user).toMatchObject({ token: 'abc123', full_name: 'Ama' })
  })

  it('clears a stored token that /me/ forbids', async () => {
    setStoredAuth({ token: 'abc123', account_type: 'staff', id: 1, full_name: 'Akosua' })
    server.use(http.get('http://localhost:8000/api/accounts/me/', () => new HttpResponse(null, { status: 403 })))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.user).toBeNull()
    expect(localStorage.getItem('ashantihub.auth')).toBeNull()
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

  it('updateProfile patches customers/me/profile/ as multipart/form-data', async () => {
    server.use(
      http.patch('http://localhost:8000/api/accounts/customers/me/profile/', async ({ request }) => {
        const formData = await request.formData()
        expect(formData.get('full_name')).toBe('Ama Boateng')
        expect(formData.get('avatar')).toBeNull()
        return HttpResponse.json({ full_name: 'Ama Boateng', avatar: null })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.updateProfile({ full_name: 'Ama Boateng', avatar: null })
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

describe('re-checks /me/ when connectivity returns', () => {
  const stored = { token: 'abc123', account_type: 'staff', id: 1, full_name: 'Akosua', permissions: ['users.view'] }

  async function launchOffline() {
    setStoredAuth(stored)
    let calls = 0
    const responses = []
    server.use(http.get('http://localhost:8000/api/accounts/me/', () => {
      calls += 1
      const next = responses.shift()
      return next ? next() : HttpResponse.error()
    }))
    const hook = renderHook(() => useAuth())
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    expect(hook.result.current.user).toEqual(stored)
    expect(getNetworkStatus().offline).toBe(true)
    return { hook, responses, calls: () => calls }
  }

  it('re-fetches /me/ on the offline → online transition and merges the new payload into user + storage', async () => {
    const { hook, responses, calls } = await launchOffline()
    expect(calls()).toBe(1)
    responses.push(() => HttpResponse.json({ account_type: 'staff', id: 1, full_name: 'Akosua', permissions: ['users.view', 'kyc.review'] }))
    act(() => reportApiResponse())
    await waitFor(() => expect(hook.result.current.user.permissions).toEqual(['users.view', 'kyc.review']))
    expect(calls()).toBe(2)
    expect(hook.result.current.user).toEqual({ ...stored, permissions: ['users.view', 'kyc.review'] })
    expect(JSON.parse(localStorage.getItem('ashantihub.auth'))).toEqual({ ...stored, permissions: ['users.view', 'kyc.review'] })
  })

  it('also re-checks on the window online event', async () => {
    const { hook, responses, calls } = await launchOffline()
    responses.push(() => HttpResponse.json({ account_type: 'staff', id: 1, full_name: 'Akosua A.', permissions: [] }))
    act(() => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(hook.result.current.user.full_name).toBe('Akosua A.'))
    expect(calls()).toBe(2)
  })

  it('ends the session when the re-check is forbidden', async () => {
    const { hook, responses } = await launchOffline()
    responses.push(() => new HttpResponse(null, { status: 403 }))
    act(() => reportApiResponse())
    await waitFor(() => expect(hook.result.current.user).toBeNull())
    expect(localStorage.getItem('ashantihub.auth')).toBeNull()
  })

  it('keeps the session when the re-check fails with a server error', async () => {
    const { hook, responses, calls } = await launchOffline()
    responses.push(() => new HttpResponse(null, { status: 500 }))
    act(() => reportApiResponse())
    await waitFor(() => expect(calls()).toBe(2))
    await act(async () => {})
    expect(hook.result.current.user).toEqual(stored)
    expect(JSON.parse(localStorage.getItem('ashantihub.auth'))).toEqual(stored)
  })

  it('does not re-check without a transition, or without a stored session', async () => {
    // Online the whole time: a later response is not a transition.
    setStoredAuth(stored)
    let calls = 0
    server.use(http.get('http://localhost:8000/api/accounts/me/', () => { calls += 1; return HttpResponse.json({ account_type: 'staff' }) }))
    const { result, unmount } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    act(() => reportApiResponse())
    await act(async () => {})
    expect(calls).toBe(1)
    unmount()

    // Signed out: a transition does not call /me/.
    setStoredAuth(null)
    calls = 0
    const second = renderHook(() => useAuth())
    await waitFor(() => expect(second.result.current.isLoading).toBe(false))
    act(() => reportApiNetworkFailure())
    act(() => reportApiResponse())
    await act(async () => {})
    expect(calls).toBe(0)
  })

})

describe('useAuth — 2-step sign-in and activation', () => {
  it('returns the 2-step challenge from login without storing anything', async () => {
    server.use(http.post('http://localhost:8000/api/accounts/staff/login/', () => HttpResponse.json({ two_factor_required: true, mfa_token: 'mfa' })))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    let challenge
    await act(async () => { challenge = await result.current.login('staff', 'boss@example.com', 'pw') })
    expect(challenge).toEqual({ two_factor_required: true, mfa_token: 'mfa' })
    expect(result.current.user).toBeNull()
    expect(localStorage.getItem('ashantihub.auth')).toBeNull()
  })

  it('finishes a 2-step sign-in with the code', async () => {
    let body = null
    server.use(
      http.post('http://localhost:8000/api/accounts/staff/login/two-factor/', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ token: 'tok', account_type: 'staff', id: 1, full_name: 'Simon Peter', role: 'super_admin', permissions: [] })
      }),
      http.get('http://localhost:8000/api/accounts/me/', () => HttpResponse.json({ account_type: 'staff', id: 1, full_name: 'Simon Peter', role: 'super_admin', permissions: [] })),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => { await result.current.verifyTwoFactor('mfa', { code: '123456' }) })
    expect(result.current.user).toMatchObject({ token: 'tok', full_name: 'Simon Peter' })
    expect(body).toEqual({ mfa_token: 'mfa', code: '123456' })
  })

  it('sends a recovery code under recovery_code', async () => {
    let body = null
    server.use(
      http.post('http://localhost:8000/api/accounts/staff/login/two-factor/', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ token: 'tok', account_type: 'staff' })
      }),
      http.get('http://localhost:8000/api/accounts/me/', () => HttpResponse.json({ account_type: 'staff', id: 1, full_name: 'Simon Peter', role: 'super_admin', permissions: [] })),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => { await result.current.verifyTwoFactor('mfa', { recoveryCode: 'abcde-fghjk' }) })
    expect(body).toEqual({ mfa_token: 'mfa', recovery_code: 'abcde-fghjk' })
  })

  it('confirming enrolment returns the codes and the sign-in payload without signing in', async () => {
    server.use(http.post('http://localhost:8000/api/accounts/staff/two-factor/enrol/confirm/', () => HttpResponse.json({ token: 'tok', account_type: 'staff', recovery_codes: ['a', 'b'] })))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    let out
    await act(async () => { out = await result.current.confirmTwoFactorEnrolment('mfa', '123456') })
    expect(out).toEqual({ recoveryCodes: ['a', 'b'], login: { token: 'tok', account_type: 'staff' } })
    expect(result.current.user).toBeNull()
    expect(localStorage.getItem('ashantihub.auth')).toBeNull()
  })

  it('activateStaff returns the challenge and stores nothing when a second step is due', async () => {
    server.use(http.post('http://localhost:8000/api/accounts/staff/activate/', () => HttpResponse.json({ status: 'activated', two_factor_setup_required: true, mfa_token: 'mfa' })))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    let out
    await act(async () => { out = await result.current.activateStaff('inv', 'a-good-password') })
    expect(out).toMatchObject({ two_factor_setup_required: true, mfa_token: 'mfa' })
    expect(result.current.user).toBeNull()
    expect(localStorage.getItem('ashantihub.auth')).toBeNull()
  })

  it('activateStaff still stores the session when a token comes back', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/staff/activate/', () => HttpResponse.json({ status: 'activated', token: 'tok' })),
      http.get('http://localhost:8000/api/accounts/me/', () => HttpResponse.json({ account_type: 'staff', id: 5, full_name: 'New Staffer', role: 'support', permissions: [] })),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => { await result.current.activateStaff('inv', 'a-good-password') })
    expect(result.current.user).toMatchObject({ token: 'tok', full_name: 'New Staffer' })
  })
})

