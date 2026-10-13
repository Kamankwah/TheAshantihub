import { useSyncExternalStore } from 'react'
import { apiPost } from '../apiClient.js'

// A rider's location, shared only while the staff app is open and the rider is on shift. A web page
// cannot track in the background, so this stops with the page (and the server greys the pin out
// after the stale limit). Pings go every 15 s on a job and every 60 s otherwise; the screen is
// kept awake with the Wake Lock API where the phone has one.
//
// The store holds the last fix the phone gave, so a step button can stamp it without waiting for a
// new reading. A fix older than MAX_FIX_AGE_MS is never used for a step: a fresh one is asked for.
const MAX_FIX_AGE_MS = 30000
export const PING_ON_JOB_MS = 15000
export const PING_IDLE_MS = 60000

let state = { status: 'off', fix: null, error: '' }
const listeners = new Set()
const set = (patch) => { state = { ...state, ...patch }; listeners.forEach((fn) => fn()) }
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
const snapshot = () => state

export const useRiderLocation = () => useSyncExternalStore(subscribe, snapshot, snapshot)
export const resetRiderTrackingForTests = () => { stopTracking(); state = { status: 'off', fix: null, error: '' }; listeners.forEach((fn) => fn()) }

const toFix = (pos) => ({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy_m: pos.coords.accuracy, speed_mps: pos.coords.speed ?? null, at: pos.timestamp || Date.now() })

let watchId = null
let timer = null
let wakeLock = null
let interval = PING_IDLE_MS
let lastSent = 0

async function send() {
  const fix = state.fix
  if (!fix) return
  lastSent = Date.now()
  try {
    await apiPost('/api/delivery/rider/ping/', { lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy_m, speed_mps: fix.speed_mps })
  } catch {
    // A missed ping is not an error the rider can fix; the next one goes in 15 or 60 seconds.
  }
}

async function holdScreen() {
  try {
    if (typeof navigator !== 'undefined' && navigator.wakeLock && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen')
      wakeLock.addEventListener?.('release', () => { wakeLock = null })
    }
  } catch {
    wakeLock = null
  }
}

export function startTracking({ onJob = false } = {}) {
  interval = onJob ? PING_ON_JOB_MS : PING_IDLE_MS
  if (watchId !== null) return
  if (typeof navigator === 'undefined' || !navigator.geolocation) { set({ status: 'unsupported', error: 'This phone cannot share its location.' }); return }
  set({ status: 'waiting', error: '' })
  holdScreen()
  watchId = navigator.geolocation.watchPosition(
    (pos) => { set({ status: 'sharing', fix: toFix(pos), error: '' }); if (Date.now() - lastSent >= interval) send() },
    (err) => set({ status: err.code === 1 ? 'denied' : 'waiting', error: err.code === 1 ? 'Location is blocked for this app. Allow it in the phone settings.' : 'Waiting for a location fix.' }),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  )
  timer = setInterval(() => { if (state.fix && Date.now() - lastSent >= interval) send() }, 5000)
}

export function setPingSpeed(onJob) {
  interval = onJob ? PING_ON_JOB_MS : PING_IDLE_MS
}

export function stopTracking() {
  if (watchId !== null && typeof navigator !== 'undefined') navigator.geolocation?.clearWatch(watchId)
  watchId = null
  if (timer) clearInterval(timer)
  timer = null
  try { wakeLock?.release?.() } catch { /* already released */ }
  wakeLock = null
  lastSent = 0
  if (state.status !== 'off') set({ status: 'off', fix: null, error: '' })
}

// A reading to stamp a step with: the last fix if it is fresh, else one asked for now.
export function currentFix() {
  const fix = state.fix
  if (fix && Date.now() - fix.at < MAX_FIX_AGE_MS) return Promise.resolve(fix)
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { reject(new Error('This phone cannot share its location.')); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => { const f = toFix(pos); set({ fix: f }); resolve(f) },
      () => reject(new Error('We could not get your location. Allow location for this app and try again.')),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    )
  })
}

// Straight-line metres between two points.
export function metresBetween(aLat, aLng, bLat, bLng) {
  const R = 6371000
  const rad = (x) => (x * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLng = rad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
