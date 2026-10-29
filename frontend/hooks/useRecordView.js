import { useEffect, useRef } from 'react'
import { apiPost } from '../apiClient.js'

// POST /api/listings/<id>/view/ — the "customers also viewed" signal. One post
// per listing once the page has been on screen for three seconds (a hidden tab
// does not count until it is shown). A signed-in customer sends `{}`; a
// signed-out visitor sends `{viewer}`, an anonymous id kept in this browser.
// It is analytics only: nothing waits for it and every failure is ignored.
const VIEWER_KEY = 'ashantihub.viewerId'
const DELAY_MS = 3000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

let sessionViewer = null

function newUuid() {
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  const bytes = new Uint8Array(16)
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes)
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// The browser's anonymous viewer id (a v4 uuid), created on first use. When
// storage is unavailable the id lives in memory for this session instead.
export function anonymousViewerId() {
  try {
    const stored = localStorage.getItem(VIEWER_KEY)
    if (stored && UUID.test(stored)) return stored
    const id = newUuid()
    localStorage.setItem(VIEWER_KEY, id)
    return id
  } catch {
    if (!sessionViewer) sessionViewer = newUuid()
    return sessionViewer
  }
}

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

export function useRecordView(id, user) {
  const signedIn = Boolean(user)
  const recorded = useRef(null)

  useEffect(() => {
    if (id == null || recorded.current === id || typeof document === 'undefined') return undefined
    let timer = null
    const fire = () => {
      timer = null
      recorded.current = id
      const body = signedIn ? {} : { viewer: anonymousViewerId() }
      apiPost(`/api/listings/${id}/view/`, body).catch(() => {})
    }
    const start = () => { if (timer == null && !hidden()) timer = setTimeout(fire, DELAY_MS) }
    const stop = () => { if (timer != null) { clearTimeout(timer); timer = null } }
    const onVisibility = () => (hidden() ? stop() : start())
    document.addEventListener('visibilitychange', onVisibility)
    start()
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [id, signedIn])
}
