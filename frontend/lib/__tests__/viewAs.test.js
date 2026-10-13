import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiDownload, apiFetch, apiPatch, apiPost, setStoredAuth } from '../../apiClient.js'
import { server } from '../../mocks/server.js'
import { VIEW_ONLY_EVENT, clearViewAs, setViewAs, setViewAsLive, setViewAsScreen, viewFor } from '../viewAs.js'

const API = 'http://localhost:8000'
const ESI = { id: 7, full_name: 'Esi Nyarko', role: 'support', role_label: 'Support', team: 'support' }

function capture(path, method = 'get') {
  const seen = []
  server.use(http[method](`${API}${path}`, ({ request }) => {
    seen.push({ viewAs: request.headers.get('X-View-As'), screen: request.headers.get('X-View-As-Screen'), url: request.url })
    return HttpResponse.json({ ok: true })
  }))
  return seen
}

describe('step-in requests (lib/viewAs.js through apiClient)', () => {
  beforeEach(() => {
    setStoredAuth({ token: 'token-of-simon', account_type: 'staff', id: 1 })
    setViewAs(ESI, 'token-of-simon', '2026-10-13T11:46:00Z')
  })
  afterEach(() => {
    clearViewAs()
    setStoredAuth(null)
  })

  it('names the person and the screen on reads only while the stepped-in shell is mounted', async () => {
    const seen = capture('/api/approvals/counts/')
    await apiFetch('/api/approvals/counts/')
    setViewAsLive(true)
    setViewAsScreen('approvals')
    await apiFetch('/api/approvals/counts/')
    setViewAsLive(false)
    await apiFetch('/api/approvals/counts/')
    expect(seen.map((s) => [s.viewAs, s.screen])).toEqual([[null, null], ['7', 'approvals'], [null, null]])
  })

  it("never sends the Super Admin's own /me or the step-in endpoints through the view", async () => {
    setViewAsLive(true)
    const me = capture('/api/accounts/me/')
    await apiFetch('/api/accounts/me/')
    await apiFetch('/api/accounts/me/?viewing=1')
    expect(me.map((s) => s.viewAs)).toEqual([null, '7'])
    const people = capture('/api/accounts/staff/view-as/')
    await apiFetch('/api/accounts/staff/view-as/')
    expect(people[0].viewAs).toBeNull()
    const ended = capture('/api/accounts/staff/view-as/end/', 'post')
    await apiPost('/api/accounts/staff/view-as/end/', {})
    expect(ended).toHaveLength(1)
    expect(ended[0].viewAs).toBeNull()
  })

  it('never sends a write or a download while viewing, failing like the server would', async () => {
    setViewAsLive(true)
    const writes = capture('/api/notifications/read-all/', 'post')
    const blocked = vi.fn()
    window.addEventListener(VIEW_ONLY_EVENT, blocked)
    const error = await apiPost('/api/notifications/read-all/', {}).catch((e) => e)
    await expect(apiPatch('/api/reports/1/', {})).rejects.toMatchObject({ status: 403 })
    await expect(apiDownload('/api/activity/export/?format=csv', 'a.csv')).rejects.toMatchObject({ body: { code: 'view_only' } })
    window.removeEventListener(VIEW_ONLY_EVENT, blocked)
    expect(error.status).toBe(403)
    expect(error.body.code).toBe('view_only')
    expect(writes).toHaveLength(0)
    expect(blocked).toHaveBeenCalledTimes(3)
    // A sign-out after the view ended goes out as the Super Admin.
    setViewAsLive(false)
    const logout = capture('/api/accounts/staff/logout/', 'post')
    await apiPost('/api/accounts/staff/logout/', {})
    expect(logout).toHaveLength(1)
    expect(logout[0].viewAs).toBeNull()
  })

  it('belongs to the sign-in it was started under', async () => {
    setViewAsLive(true)
    setStoredAuth({ token: 'token-of-someone-else', account_type: 'staff', id: 9 })
    expect(viewFor('token-of-someone-else')).toBeNull()
    const seen = capture('/api/approvals/counts/')
    await apiFetch('/api/approvals/counts/')
    expect(seen[0].viewAs).toBeNull()
    capture('/api/notifications/read-all/', 'post')
    await expect(apiPost('/api/notifications/read-all/', {})).resolves.toEqual({ ok: true })
  })
})
