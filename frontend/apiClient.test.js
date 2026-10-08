import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from './mocks/server.js'
import { SESSION_ENDED_EVENT, apiFetch, getStoredAuth, setStoredAuth, apiPost, apiPostForm, apiPatch, apiPatchForm, apiDelete, apiDownload } from './apiClient.js'
import { getNetworkStatus, resetNetworkStatusForTests } from './lib/networkStatus.js'

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

describe('apiDelete', () => {
  it('sends a DELETE request and resolves to null on a 204 response', async () => {
    server.use(
      http.delete('http://localhost:8000/api/cart/items/1/', () => new HttpResponse(null, { status: 204 })),
    )
    const data = await apiDelete('/api/cart/items/1/')
    expect(data).toBeNull()
  })

  it('throws on a non-2xx response', async () => {
    server.use(
      http.delete('http://localhost:8000/api/cart/items/1/', () => new HttpResponse(null, { status: 404 })),
    )
    await expect(apiDelete('/api/cart/items/1/')).rejects.toThrow()
  })
})

describe('network status reporting', () => {
  afterEach(() => resetNetworkStatusForTests())

  it('marks the network store offline when fetch rejects, rethrowing the original error, and clears it on the next response of any status', async () => {
    server.use(http.get('http://localhost:8000/api/listings/categories/', () => HttpResponse.error()))
    let thrown
    try { await apiFetch('/api/listings/categories/') } catch (error) { thrown = error }
    expect(thrown).toBeInstanceOf(TypeError)
    expect(thrown.status).toBeUndefined()
    expect(getNetworkStatus().offline).toBe(true)

    server.use(http.post('http://localhost:8000/api/listings/', () => new HttpResponse(null, { status: 400 })))
    await expect(apiPost('/api/listings/', {})).rejects.toMatchObject({ status: 400 })
    expect(getNetworkStatus().offline).toBe(false)

    server.use(http.delete('http://localhost:8000/api/listings/1/', () => HttpResponse.error()))
    await expect(apiDelete('/api/listings/1/')).rejects.toBeInstanceOf(TypeError)
    expect(getNetworkStatus().offline).toBe(true)

    server.use(http.get('http://localhost:8000/api/listings/categories/', () => HttpResponse.json([])))
    await expect(apiFetch('/api/listings/categories/')).resolves.toEqual([])
    expect(getNetworkStatus().offline).toBe(false)
  })
})

describe('session-ended event', () => {
  it('fires on a 401 only when a session was stored', async () => {
    const heard = vi.fn()
    window.addEventListener(SESSION_ENDED_EVENT, heard)
    server.use(http.get('http://localhost:8000/api/accounts/me/', () => new HttpResponse(null, { status: 401 })))
    setStoredAuth({ token: 'expired', account_type: 'staff', id: 1, full_name: 'Esi' })
    await expect(apiFetch('/api/accounts/me/')).rejects.toMatchObject({ status: 401 })
    await expect(apiFetch('/api/accounts/me/')).rejects.toMatchObject({ status: 401 })
    expect(heard).toHaveBeenCalledTimes(1)
    window.removeEventListener(SESSION_ENDED_EVENT, heard)
  })
})

describe('session-ended event — stale responses', () => {
  it('a 401 for an older token does not end a newer session', async () => {
    const heard = vi.fn()
    window.addEventListener(SESSION_ENDED_EVENT, heard)
    server.use(http.get('http://localhost:8000/api/accounts/me/', () => {
      setStoredAuth({ token: 'newer', account_type: 'staff', id: 1, full_name: 'Esi' })
      return new HttpResponse(null, { status: 401 })
    }))
    setStoredAuth({ token: 'older', account_type: 'staff', id: 1, full_name: 'Esi' })
    await expect(apiFetch('/api/accounts/me/')).rejects.toMatchObject({ status: 401 })
    expect(getStoredAuth()).toMatchObject({ token: 'newer' })
    expect(heard).not.toHaveBeenCalled()
    window.removeEventListener(SESSION_ENDED_EVENT, heard)
    setStoredAuth(null)
  })
})

describe('apiDownload', () => {
  it('returns the JSON body when the server queues the file (202)', async () => {
    server.use(http.get('http://localhost:8000/api/dl/', () => HttpResponse.json({ id: 4, status: 'queued' }, { status: 202 })))
    expect(await apiDownload('/api/dl/', 'x.csv')).toEqual({ id: 4, status: 'queued' })
  })

  it('throws an error carrying status and body on a 4xx', async () => {
    server.use(http.get('http://localhost:8000/api/dl/', () => HttpResponse.json({ detail: 'Nope.' }, { status: 403 })))
    await expect(apiDownload('/api/dl/', 'x.csv')).rejects.toMatchObject({ status: 403, body: { detail: 'Nope.' } })
  })
})
