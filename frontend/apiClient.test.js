import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from './mocks/server.js'
import { apiFetch, getStoredAuth, setStoredAuth, apiPost, apiPostForm, apiPatch, apiPatchForm } from './apiClient.js'

describe('apiFetch', () => {
  it('returns parsed JSON on success', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/categories/', () => {
        return HttpResponse.json([{ id: 1, slug: 'hotels', icon: '🏨', label: 'Hotels', color: '#000080' }])
      }),
    )
    const data = await apiFetch('/api/listings/categories/')
    expect(data).toEqual([{ id: 1, slug: 'hotels', icon: '🏨', label: 'Hotels', color: '#000080' }])
  })

  it('throws on a non-2xx response', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/999/', () => {
        return new HttpResponse(null, { status: 404 })
      }),
    )
    await expect(apiFetch('/api/listings/999/')).rejects.toThrow()
  })
})

describe('auth storage', () => {
  it('returns null when nothing is stored', () => {
    expect(getStoredAuth()).toBeNull()
  })

  it('round-trips a stored auth object', () => {
    setStoredAuth({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
    expect(getStoredAuth()).toEqual({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
  })

  it('clears storage when set to null', () => {
    setStoredAuth({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
    setStoredAuth(null)
    expect(getStoredAuth()).toBeNull()
  })
})

describe('apiFetch with a stored token', () => {
  it('attaches an Authorization header when a token is present', async () => {
    setStoredAuth({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
    let receivedAuth
    server.use(
      http.get('http://localhost:8000/api/accounts/me/', ({ request }) => {
        receivedAuth = request.headers.get('authorization')
        return HttpResponse.json({ account_type: 'customer', id: 1, full_name: 'Ama' })
      }),
    )
    await apiFetch('/api/accounts/me/')
    expect(receivedAuth).toBe('Bearer abc123')
    setStoredAuth(null)
  })

  it('clears stored auth on a 401 response', async () => {
    setStoredAuth({ token: 'expired', account_type: 'customer', id: 1, full_name: 'Ama' })
    server.use(
      http.get('http://localhost:8000/api/accounts/me/', () => {
        return new HttpResponse(null, { status: 401 })
      }),
    )
    await expect(apiFetch('/api/accounts/me/')).rejects.toThrow()
    expect(getStoredAuth()).toBeNull()
  })
})

describe('apiPost', () => {
  it('sends a JSON body and returns the parsed response', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/customers/login/', async ({ request }) => {
        const body = await request.json()
        expect(body).toEqual({ identifier: '+233241234567', password: 'secret' })
        return HttpResponse.json({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
      }),
    )
    const data = await apiPost('/api/accounts/customers/login/', { identifier: '+233241234567', password: 'secret' })
    expect(data).toEqual({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
  })

  it('throws on a non-2xx response', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/customers/login/', () => {
        return HttpResponse.json({ non_field_errors: ['Invalid credentials'] }, { status: 400 })
      }),
    )
    await expect(apiPost('/api/accounts/customers/login/', { identifier: 'x', password: 'y' })).rejects.toThrow()
  })
})

describe('apiPostForm', () => {
  it('sends a FormData body without setting Content-Type manually', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/business-owners/register/', async ({ request }) => {
        const formData = await request.formData()
        expect(formData.get('full_name')).toBe('Abena Boateng')
        return HttpResponse.json({ id: 1, token: 'abc123' }, { status: 201 })
      }),
    )
    const formData = new FormData()
    formData.append('full_name', 'Abena Boateng')
    const data = await apiPostForm('/api/accounts/business-owners/register/', formData)
    expect(data).toEqual({ id: 1, token: 'abc123' })
  })
})

describe('apiPatch', () => {
  it('sends a JSON body via PATCH and returns the parsed response', async () => {
    server.use(
      http.patch('http://localhost:8000/api/listings/mine/1/', async ({ request }) => {
        const body = await request.json()
        expect(body).toEqual({ name: 'Updated Room', price_amount: '500.00' })
        return HttpResponse.json({ id: 1, name: 'Updated Room', price_amount: '500.00' })
      }),
    )
    const data = await apiPatch('/api/listings/mine/1/', { name: 'Updated Room', price_amount: '500.00' })
    expect(data).toEqual({ id: 1, name: 'Updated Room', price_amount: '500.00' })
  })

  it('throws on a non-2xx response', async () => {
    server.use(
      http.patch('http://localhost:8000/api/listings/mine/1/', () => {
        return HttpResponse.json({ status: 'Cannot edit a published listing.' }, { status: 400 })
      }),
    )
    await expect(apiPatch('/api/listings/mine/1/', { name: 'x' })).rejects.toThrow()
  })
})

describe('apiPatchForm', () => {
  it('sends a PATCH request with the given FormData', async () => {
    server.use(
      http.patch('http://localhost:8000/api/accounts/business-owners/me/profile/', async ({ request }) => {
        const formData = await request.formData()
        expect(formData.get('gps_address')).toBe('AK-039-5028')
        return HttpResponse.json({ gps_address: 'AK-039-5028' })
      }),
    )
    const formData = new FormData()
    formData.append('gps_address', 'AK-039-5028')
    const data = await apiPatchForm('/api/accounts/business-owners/me/profile/', formData)
    expect(data).toEqual({ gps_address: 'AK-039-5028' })
  })
})
