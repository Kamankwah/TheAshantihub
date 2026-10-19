import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// The marketplace opening, timed by the server's clock (never the device's).
// GET /api/storefront/opening/ → {opens_at, server_now, is_open, gate_enabled}.
// The offset between the server's clock and this device's is captured the
// moment the answer arrives; from then on "now" is Date.now() + offset, so a
// phone whose clock is days out still counts down to the real opening.
export const OPENING_QUERY_KEY = ['storefront-opening']
const MAX_TIMEOUT = 2 ** 31 - 1

async function fetchOpening() {
  const data = await apiFetch('/api/storefront/opening/')
  const offset = Date.parse(data?.server_now) - Date.now()
  return { ...data, offset: Number.isFinite(offset) ? offset : 0 }
}

// useOpening({ tick }) → { isOpen, opensAt, remainingMs, loading, serverNow, gateEnabled }
//  - isOpen: true while loading, on a failed fetch, and whenever the gate is
//    off — the server still refuses a shopper's purchase before opening, so
//    the UI never blocks on a missing answer.
//  - remainingMs: ms left by the server's clock (0 once open).
//  - serverNow(): Date.now() + the captured server offset.
//  - tick (default true) re-renders every second for a visible countdown;
//    tick: false re-renders only at the opening moment (buy buttons).
// Refetches every 60 s, and once more when the countdown reaches zero (a
// Super Admin delay moves opens_at and the countdown resumes).
export function useOpening({ tick = true } = {}) {
  const query = useQuery({
    queryKey: OPENING_QUERY_KEY,
    queryFn: fetchOpening,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  const { data, refetch } = query
  const offset = data?.offset ?? 0
  const serverNow = useCallback(() => Date.now() + offset, [offset])
  const [, setRenders] = useState(0)

  const opensAtMs = data ? Date.parse(data.opens_at) : NaN
  const opensAt = Number.isFinite(opensAtMs) ? new Date(opensAtMs) : null
  const closedByServer = Boolean(data && data.gate_enabled && !data.is_open && opensAt)
  const remainingMs = closedByServer ? Math.max(0, opensAtMs - serverNow()) : 0
  const isOpen = !closedByServer || remainingMs <= 0

  useEffect(() => {
    if (isOpen) return undefined
    const rerender = () => setRenders((n) => n + 1)
    let id
    if (tick) {
      // Land each re-render just after a server-clock second boundary.
      const loop = () => {
        rerender()
        id = setTimeout(loop, 1000 - ((Date.now() + offset) % 1000) + 5)
      }
      id = setTimeout(loop, 1000 - ((Date.now() + offset) % 1000) + 5)
    } else {
      id = setTimeout(rerender, Math.min(Math.max(0, opensAtMs - (Date.now() + offset)) + 50, MAX_TIMEOUT))
    }
    return () => clearTimeout(id)
  }, [isOpen, tick, offset, opensAtMs])

  // At zero, ask the server once for this opening time.
  const refetchedFor = useRef(null)
  useEffect(() => {
    if (closedByServer && isOpen && refetchedFor.current !== opensAtMs) {
      refetchedFor.current = opensAtMs
      refetch()
    }
  }, [closedByServer, isOpen, opensAtMs, refetch])

  return {
    isOpen,
    opensAt,
    remainingMs,
    loading: query.isPending,
    serverNow,
    gateEnabled: Boolean(data?.gate_enabled),
  }
}
