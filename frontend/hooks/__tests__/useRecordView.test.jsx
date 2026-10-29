import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../mocks/server.js'
import { anonymousViewerId, useRecordView } from '../useRecordView.js'

const API = 'http://localhost:8000'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function capture(id) {
  const posts = []
  server.use(http.post(`${API}/api/listings/${id}/view/`, async ({ request }) => {
    posts.push(await request.json())
    return new HttpResponse(null, { status: 204 })
  }))
  return posts
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('useRecordView', () => {
  test('a signed-in customer sends an empty body once, after three seconds', async () => {
    const posts = capture(5)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderHook(() => useRecordView(5, { id: 1, accountType: 'customer' }))
    await act(async () => { vi.advanceTimersByTime(2900) })
    expect(posts).toHaveLength(0)
    await act(async () => { vi.advanceTimersByTime(200) })
    await waitFor(() => expect(posts).toEqual([{}]))
  })

  test('leaving before three seconds records nothing', async () => {
    const posts = capture(5)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { unmount } = renderHook(() => useRecordView(5, null))
    await act(async () => { vi.advanceTimersByTime(1500) })
    unmount()
    await act(async () => { vi.advanceTimersByTime(5000) })
    await new Promise((r) => setTimeout(r, 30))
    expect(posts).toHaveLength(0)
  })

  test('a hidden tab does not count until it is on screen', async () => {
    const posts = capture(5)
    let state = 'hidden'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderHook(() => useRecordView(5, null))
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(posts).toHaveLength(0)
    state = 'visible'
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { vi.advanceTimersByTime(3100) })
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].viewer).toMatch(UUID)
  })

  // An unhandled rejection would fail the run; the throttled answer must be swallowed.
  test('a failed post is ignored silently', async () => {
    let calls = 0
    server.use(http.post(`${API}/api/listings/5/view/`, () => { calls += 1; return HttpResponse.json({ detail: 'Request was throttled.' }, { status: 429 }) }))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderHook(() => useRecordView(5, null))
    await act(async () => { vi.advanceTimersByTime(3100) })
    await waitFor(() => expect(calls).toBe(1))
    await new Promise((r) => setTimeout(r, 30))
  })
})

describe('anonymousViewerId', () => {
  test('is a v4 uuid kept in this browser', () => {
    const first = anonymousViewerId()
    expect(first).toMatch(UUID)
    expect(anonymousViewerId()).toBe(first)
    expect(localStorage.getItem('ashantihub.viewerId')).toBe(first)
  })

  test('a corrupted stored value is replaced', () => {
    localStorage.setItem('ashantihub.viewerId', 'not-a-uuid')
    expect(anonymousViewerId()).toMatch(UUID)
  })

  test('without storage the id still holds for the session', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const first = anonymousViewerId()
    expect(first).toMatch(UUID)
    expect(anonymousViewerId()).toBe(first)
  })
})
