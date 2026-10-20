import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from './mocks/server.js'
import { SESSION_ENDED_EVENT, UNAUTHORIZED_EVENT, apiFetch, getStoredAuth, setStoredAuth, apiPost, apiPostForm, apiPatch, apiPatchForm, apiDelete, apiDownload, setSudoHandler, setStepUpHandler } from './apiClient.js'
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

describe('unauthorized event', () => {
  it('fires on a 401 that ended no stored session, and never alongside session-ended', async () => {
    const ended = vi.fn()
    const unauthorized = vi.fn()
    window.addEventListener(SESSION_ENDED_EVENT, ended)
    window.addEventListener(UNAUTHORIZED_EVENT, unauthorized)
    server.use(http.get('http://localhost:8000/api/accounts/me/', () => new HttpResponse(null, { status: 401 })))
    setStoredAuth({ token: 'expired', account_type: 'staff', id: 1, full_name: 'Esi' })
    await expect(apiFetch('/api/accounts/me/')).rejects.toMatchObject({ status: 401 })
    expect([ended.mock.calls.length, unauthorized.mock.calls.length]).toEqual([1, 0])
    await expect(apiFetch('/api/accounts/me/')).rejects.toMatchObject({ status: 401 })
    expect([ended.mock.calls.length, unauthorized.mock.calls.length]).toEqual([1, 1])
    window.removeEventListener(SESSION_ENDED_EVENT, ended)
    window.removeEventListener(UNAUTHORIZED_EVENT, unauthorized)
  })
})

describe('apiDownload — a 401', () => {
  it('ends the stored session and fires session-ended, like the other helpers', async () => {
    const heard = vi.fn()
    window.addEventListener(SESSION_ENDED_EVENT, heard)
    server.use(http.get('http://localhost:8000/api/dl/', () => new HttpResponse(null, { status: 401 })))
    setStoredAuth({ token: 'expired', account_type: 'staff', id: 1, full_name: 'Esi' })
    await expect(apiDownload('/api/dl/', 'x.csv')).rejects.toMatchObject({ status: 401 })
    expect(getStoredAuth()).toBeNull()
    expect(heard).toHaveBeenCalledTimes(1)
    window.removeEventListener(SESSION_ENDED_EVENT, heard)
  })

  it('leaves a newer session alone when the 401 was for an older token', async () => {
    const heard = vi.fn()
    window.addEventListener(SESSION_ENDED_EVENT, heard)
    server.use(http.get('http://localhost:8000/api/dl/', () => {
      setStoredAuth({ token: 'newer', account_type: 'staff', id: 1, full_name: 'Esi' })
      return new HttpResponse(null, { status: 401 })
    }))
    setStoredAuth({ token: 'older', account_type: 'staff', id: 1, full_name: 'Esi' })
    await expect(apiDownload('/api/dl/', 'x.csv')).rejects.toMatchObject({ status: 401 })
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

describe('setSudoHandler', () => {
  const needSudo = () => HttpResponse.json({ detail: 'Re-enter your password to continue.', code: 'sudo_required' }, { status: 403 })

  it('surfaces the 403 untouched when no handler is registered', async () => {
    server.use(http.post('http://localhost:8000/api/s/', needSudo))
    await expect(apiPost('/api/s/', {})).rejects.toMatchObject({ status: 403, body: { code: 'sudo_required' } })
  })

  it('retries once after the handler resolves true, for GETs too', async () => {
    let calls = 0
    server.use(http.get('http://localhost:8000/api/s/', () => { calls += 1; return calls === 1 ? needSudo() : HttpResponse.json({ ok: 1 }) }))
    const off = setSudoHandler(async () => true)
    await expect(apiFetch('/api/s/')).resolves.toEqual({ ok: 1 })
    off()
    expect(calls).toBe(2)
  })

  it('does not call the handler for an ordinary 403', async () => {
    const handler = vi.fn(async () => true)
    server.use(http.post('http://localhost:8000/api/s/', () => HttpResponse.json({ detail: 'No.' }, { status: 403 })))
    const off = setSudoHandler(handler)
    await expect(apiPost('/api/s/', {})).rejects.toMatchObject({ status: 403 })
    off()
    expect(handler).not.toHaveBeenCalled()
  })

  it('an old unregister does not remove a newer handler', async () => {
    const off1 = setSudoHandler(async () => false)
    const handler2 = vi.fn(async () => false)
    const off2 = setSudoHandler(handler2)
    off1()
    server.use(http.post('http://localhost:8000/api/s/', needSudo))
    await expect(apiPost('/api/s/', {})).rejects.toMatchObject({ status: 403 })
    off2()
    expect(handler2).toHaveBeenCalledTimes(1)
  })
})

describe('second-person and password contracts of the staff APIs', () => {
  const needSudo = () => HttpResponse.json({ detail: 'Re-enter your password to continue.', code: 'sudo_required' }, { status: 403 })

  it('retries a POST to /api/ledger/orders/7/verification/ once after sudo_required', async () => {
    let calls = 0
    server.use(http.post('http://localhost:8000/api/ledger/orders/7/verification/', () => { calls += 1; return calls === 1 ? needSudo() : HttpResponse.json({ ok: 1 }) }))
    const off = setSudoHandler(async () => true)
    await expect(apiPost('/api/ledger/orders/7/verification/', { outcome: 'verified' })).resolves.toEqual({ ok: 1 })
    off()
    expect(calls).toBe(2)
  })

  it('surfaces the 403 when the prompt is cancelled', async () => {
    let calls = 0
    server.use(http.post('http://localhost:8000/api/ledger/orders/7/verification/', () => { calls += 1; return needSudo() }))
    const off = setSudoHandler(async () => false)
    await expect(apiPost('/api/ledger/orders/7/verification/', {})).rejects.toMatchObject({ status: 403, body: { code: 'sudo_required' } })
    off()
    expect(calls).toBe(1)
  })

  it('does not loop when the retry is 403 again', async () => {
    let calls = 0
    const handler = vi.fn(async () => true)
    server.use(http.post('http://localhost:8000/api/ledger/orders/7/verification/', () => { calls += 1; return needSudo() }))
    const off = setSudoHandler(handler)
    await expect(apiPost('/api/ledger/orders/7/verification/', {})).rejects.toMatchObject({ status: 403 })
    off()
    expect(calls).toBe(2)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('a 201 {approval_id, status:"pending"} from staff/withdrawals/3/fail/ resolves to the body', async () => {
    await expect(apiPost('/api/wallet/staff/withdrawals/3/fail/', { reason: 'Number not valid' })).resolves.toEqual({ approval_id: 9, status: 'pending' })
  })

  it('a staff PATCH answered 201 resolves to the body, approval ids included', async () => {
    server.use(http.patch('http://localhost:8000/api/accounts/customers/1/', () => HttpResponse.json({ id: 1, approval_id: 5, approval_ids: [5], status: 'pending' }, { status: 201 })))
    await expect(apiPatch('/api/accounts/customers/1/', { phone: '0240000000' })).resolves.toMatchObject({ approval_id: 5, approval_ids: [5] })
  })
})


describe('setStepUpHandler', () => {
  const URL = 'http://localhost:8000/api/step/'
  const needStepUp = (action = 'withdrawal') => HttpResponse.json({ detail: 'Enter a code.', code: 'step_up_required', action }, { status: 403 })
  const ok = (token, expiresIn = 300) => vi.fn(async () => ({ token, expiresIn }))

  afterEach(() => {
    vi.useRealTimers()
    setStoredAuth(null)
  })

  // Records every request's header; answers step_up_required until the right token arrives.
  function serve(method, { after = () => HttpResponse.json({ ok: 1 }) } = {}) {
    const seen = []
    server.use(http[method](URL, ({ request }) => {
      const token = request.headers.get('x-step-up-token')
      seen.push(token)
      return token ? after(token) : needStepUp()
    }))
    return seen
  }

  it('step_up_required retries once with X-Step-Up-Token', async () => {
    const seen = serve('post')
    const off = setStepUpHandler(ok('tok1'))
    await expect(apiPost('/api/step/', { a: 1 })).resolves.toEqual({ ok: 1 })
    off()
    expect(seen).toEqual([null, 'tok1'])
  })

  it('the handler is asked with the action named by the server', async () => {
    server.use(http.post(URL, ({ request }) => (request.headers.get('x-step-up-token') ? HttpResponse.json({ ok: 1 }) : needStepUp('payout_destination'))))
    const handler = ok('tok1')
    const off = setStepUpHandler(handler)
    await apiPost('/api/step/', {})
    off()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('payout_destination')
  })

  it('a cancelled prompt surfaces the original 403', async () => {
    const seen = serve('post')
    const off = setStepUpHandler(async () => null)
    await expect(apiPost('/api/step/', {})).rejects.toMatchObject({ status: 403, body: { code: 'step_up_required', action: 'withdrawal' } })
    off()
    expect(seen).toEqual([null])
  })

  it('a second step_up_required is not retried again', async () => {
    let calls = 0
    server.use(http.post(URL, () => { calls += 1; return needStepUp() }))
    const handler = ok('tok1')
    const off = setStepUpHandler(handler)
    await expect(apiPost('/api/step/', {})).rejects.toMatchObject({ status: 403, body: { code: 'step_up_required' } })
    off()
    expect(calls).toBe(2)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('no handler leaves the 403 untouched', async () => {
    const seen = serve('post')
    await expect(apiPost('/api/step/', {})).rejects.toMatchObject({ status: 403, body: { code: 'step_up_required' } })
    expect(seen).toEqual([null])
  })

  it('does not call the handler for an ordinary 403', async () => {
    const handler = ok('tok1')
    server.use(http.post(URL, () => HttpResponse.json({ detail: 'No.' }, { status: 403 })))
    const off = setStepUpHandler(handler)
    await expect(apiPost('/api/step/', {})).rejects.toMatchObject({ status: 403 })
    off()
    expect(handler).not.toHaveBeenCalled()
  })

  it('a token refused by validation is sent up front on the next identical request', async () => {
    const seen = serve('post', { after: () => HttpResponse.json({ detail: 'Bad amount.' }, { status: 400 }) })
    const off = setStepUpHandler(ok('tok1'))
    await expect(apiPost('/api/step/', { amount: 0 })).rejects.toMatchObject({ status: 400 })
    await expect(apiPost('/api/step/', { amount: 0 })).rejects.toMatchObject({ status: 400 })
    off()
    expect(seen).toEqual([null, 'tok1', 'tok1'])
  })

  it('...not on a different path', async () => {
    const seen = serve('post', { after: () => HttpResponse.json({ detail: 'Bad.' }, { status: 400 }) })
    const other = []
    server.use(http.post('http://localhost:8000/api/other/', ({ request }) => { other.push(request.headers.get('x-step-up-token')); return HttpResponse.json({ ok: 1 }) }))
    const off = setStepUpHandler(ok('tok1'))
    await expect(apiPost('/api/step/', {})).rejects.toMatchObject({ status: 400 })
    await apiPost('/api/other/', {})
    off()
    expect(seen).toEqual([null, 'tok1'])
    expect(other).toEqual([null])
  })

  it('...not on a different method', async () => {
    const seen = []
    server.use(
      http.post(URL, ({ request }) => {
        const token = request.headers.get('x-step-up-token')
        return token ? HttpResponse.json({ detail: 'Bad.' }, { status: 400 }) : needStepUp()
      }),
      http.patch(URL, ({ request }) => { seen.push(request.headers.get('x-step-up-token')); return HttpResponse.json({ ok: 1 }) }),
    )
    const off = setStepUpHandler(ok('tok1'))
    await expect(apiPost('/api/step/', {})).rejects.toMatchObject({ status: 400 })
    await apiPatch('/api/step/', {})
    off()
    expect(seen).toEqual([null])
  })

  it('...not after 5 minutes (fake timers)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const seen = serve('post', { after: () => HttpResponse.json({ detail: 'Bad.' }, { status: 400 }) })
    const off = setStepUpHandler(ok('tok1', 300))
    await expect(apiPost('/api/step/', {})).rejects.toMatchObject({ status: 400 })
    vi.advanceTimersByTime(299 * 1000)
    await expect(apiPost('/api/step/', {})).rejects.toMatchObject({ status: 400 })
    vi.advanceTimersByTime(2 * 1000)
    await expect(apiPost('/api/step/', {})).rejects.toMatchObject({ status: 400 })
    off()
    // 1st: bare, then retry; 2nd: up front; 3rd: expired so bare again, then the prompt's new token.
    expect(seen).toEqual([null, 'tok1', 'tok1', null, 'tok1'])
  })

  it('...cleared after a 2xx', async () => {
    let n = 0
    const seen = []
    server.use(http.post(URL, ({ request }) => {
      const token = request.headers.get('x-step-up-token')
      seen.push(token)
      if (!token) return needStepUp()
      n += 1
      return n === 1 ? HttpResponse.json({ detail: 'Bad.' }, { status: 400 }) : HttpResponse.json({ ok: 1 })
    }))
    const off = setStepUpHandler(ok('tok1'))
    await expect(apiPost('/api/step/', {})).rejects.toMatchObject({ status: 400 })
    await expect(apiPost('/api/step/', {})).resolves.toEqual({ ok: 1 })
    await expect(apiPost('/api/step/', {})).resolves.toEqual({ ok: 1 })
    off()
    // The third call starts bare: the success cleared the memory.
    expect(seen).toEqual([null, 'tok1', 'tok1', null, 'tok1'])
  })

  it('...cleared when the remembered token is answered with step_up_required', async () => {
    let phase = 0
    const seen = []
    server.use(http.post(URL, ({ request }) => {
      const token = request.headers.get('x-step-up-token')
      seen.push(token)
      if (!token) return needStepUp()
      phase += 1
      return phase === 1 ? HttpResponse.json({ detail: 'Bad.' }, { status: 400 }) : needStepUp()
    }))
    const off2 = setStepUpHandler(ok('tok1'))
    await expect(apiPost('/api/step/', {})).rejects.toMatchObject({ status: 400 })
    await expect(apiPost('/api/step/', {})).rejects.toMatchObject({ status: 403 })
    const afterClear = seen.length
    await expect(apiPost('/api/step/', {})).rejects.toBeTruthy()
    off2()
    expect(seen[afterClear]).toBeNull()
  })

  it('...cleared on sign-out', async () => {
    const seen = serve('post', { after: () => HttpResponse.json({ detail: 'Bad.' }, { status: 400 }) })
    const off = setStepUpHandler(ok('tok1'))
    await expect(apiPost('/api/step/', {})).rejects.toMatchObject({ status: 400 })
    setStoredAuth(null)
    await expect(apiPost('/api/step/', {})).rejects.toMatchObject({ status: 400 })
    off()
    expect(seen).toEqual([null, 'tok1', null, 'tok1'])
  })

  it('sudo_required and step_up_required each get their own single retry', async () => {
    const seen = []
    server.use(http.post(URL, ({ request }) => {
      const token = request.headers.get('x-step-up-token')
      seen.push(token)
      return token ? HttpResponse.json({ ok: 1 }) : seen.length === 1
        ? HttpResponse.json({ detail: 'Password.', code: 'sudo_required' }, { status: 403 })
        : needStepUp()
    }))
    const sudo = vi.fn(async () => true)
    const offSudo = setSudoHandler(sudo)
    const offStep = setStepUpHandler(ok('tok1'))
    await expect(apiPost('/api/step/', {})).resolves.toEqual({ ok: 1 })
    offSudo()
    offStep()
    expect(seen).toEqual([null, null, 'tok1'])
    expect(sudo).toHaveBeenCalledTimes(1)
  })

  it('unregister only removes its own handler', async () => {
    const off1 = setStepUpHandler(async () => null)
    const handler2 = ok('tok2')
    const off2 = setStepUpHandler(handler2)
    off1()
    serve('post')
    await expect(apiPost('/api/step/', {})).resolves.toEqual({ ok: 1 })
    expect(handler2).toHaveBeenCalledTimes(1)
    off2()
    await expect(apiPost('/api/step/', {})).rejects.toMatchObject({ status: 403 })
  })

  it('works for apiPatch with a JSON body and apiPost', async () => {
    const bodies = []
    server.use(http.patch(URL, async ({ request }) => {
      bodies.push(await request.json())
      return request.headers.get('x-step-up-token') === 'tok1' ? HttpResponse.json({ ok: 2 }) : needStepUp('payout_destination')
    }))
    const off = setStepUpHandler(ok('tok1'))
    await expect(apiPatch('/api/step/', { number: '024' })).resolves.toEqual({ ok: 2 })
    off()
    expect(bodies).toEqual([{ number: '024' }, { number: '024' }])
  })
})
