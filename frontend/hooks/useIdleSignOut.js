import { useEffect, useRef } from 'react'

// Staff sessions end after 30 minutes without input (spec F9). The server
// enforces 30 minutes without requests, but background polling keeps a tab
// "requesting", so the browser watches for real input itself.
export const IDLE_LIMIT_MS = 30 * 60 * 1000
const CHECK_EVERY_MS = 15 * 1000
const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart']

const SHARED_KEY = 'ashantihub.staffLastInput'
const SHARE_EVERY_MS = 10 * 1000

function readShared() {
  try { return Number(localStorage.getItem(SHARED_KEY)) || 0 } catch { return 0 }
}

export function useIdleSignOut(onIdle, { limitMs = IDLE_LIMIT_MS, enabled = true } = {}) {
  const onIdleRef = useRef(onIdle)
  useEffect(() => { onIdleRef.current = onIdle }, [onIdle])

  useEffect(() => {
    if (!enabled) return undefined
    let lastInput = Date.now()
    let lastShared = 0
    let fired = false
    const check = () => {
      if (!fired && Date.now() - Math.max(lastInput, readShared()) >= limitMs) {
        fired = true
        onIdleRef.current?.()
      }
    }
    // Check first: the first keypress after waking from sleep must not
    // rescue a session that has already been idle too long.
    const mark = () => {
      check()
      const now = Date.now()
      lastInput = now
      if (now - lastShared >= SHARE_EVERY_MS) {
        lastShared = now
        try { localStorage.setItem(SHARED_KEY, String(now)) } catch { /* storage unavailable */ }
      }
    }
    // Input in another staff tab counts as activity here.
    const onStorage = (event) => {
      if (event.key === SHARED_KEY) lastInput = Math.max(lastInput, Number(event.newValue) || 0)
    }
    INPUT_EVENTS.forEach((name) => window.addEventListener(name, mark, { passive: true }))
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', check)
    const timer = setInterval(check, CHECK_EVERY_MS)
    return () => {
      INPUT_EVENTS.forEach((name) => window.removeEventListener(name, mark))
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', check)
      clearInterval(timer)
    }
  }, [enabled, limitMs])
}
