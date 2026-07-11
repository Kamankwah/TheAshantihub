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
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.login('customer', '+233241234567', 'secret')
    })
    expect(result.current.user).toEqual({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
  })

  it('logout clears the user', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/customers/login/', () => {
        return HttpResponse.json({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
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

  it('registerBusinessOwner posts as multipart/form-data and stores the returned token', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/business-owners/register/', async ({ request }) => {
        const formData = await request.formData()
        expect(formData.get('full_name')).toBe('Abena Boateng')
        return HttpResponse.json({ id: 9, full_name: 'Abena Boateng', login_phone: '+233245551122', kyc_status: 'pending', token: 'biztoken' }, { status: 201 })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.registerBusinessOwner({ full_name: 'Abena Boateng', login_phone: '+233245551122', password: 'secretpass' })
    })
    expect(result.current.user).toEqual({ token: 'biztoken', account_type: 'business_owner', id: 9, full_name: 'Abena Boateng' })
  })
})
