import { useEffect, useRef } from 'react'

// Staff sessions end after 30 minutes without input (spec F9). The server
// enforces 30 minutes without requests, but background polling keeps a tab
// "requesting", so the browser watches for real input itself.
export const IDLE_LIMIT_MS = 30 * 60 * 1000
const CHECK_EVERY_MS = 15 * 1000
const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart']

export function useIdleSignOut(onIdle, { limitMs = IDLE_LIMIT_MS, enabled = true } = {}) {
  const onIdleRef = useRef(onIdle)
  useEffect(() => { onIdleRef.current = onIdle }, [onIdle])

  useEffect(() => {
    if (!enabled) return undefined
    let lastInput = Date.now()
    let fired = false
    const mark = () => { lastInput = Date.now() }
    const check = () => {
      if (!fired && Date.now() - lastInput >= limitMs) {
        fired = true
        onIdleRef.current?.()
      }
    }
    INPUT_EVENTS.forEach((name) => window.addEventListener(name, mark, { passive: true }))
    document.addEventListener('visibilitychange', check)
    const timer = setInterval(check, CHECK_EVERY_MS)
    return () => {
      INPUT_EVENTS.forEach((name) => window.removeEventListener(name, mark))
      document.removeEventListener('visibilitychange', check)
      clearInterval(timer)
    }
  }, [enabled, limitMs])
}
