import { saveBlob } from './lib/saveBlob.js'
import { reportApiNetworkFailure, reportApiResponse } from './lib/networkStatus.js'
import { viewAsHeaders, viewOnlyRefusal } from './lib/viewAs.js'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
const AUTH_STORAGE_KEY = 'ashantihub.auth'
// Fired when the API answers 401 for a signed-in session (an ended, idle or
// expired staff session, or a revoked token). The staff shell listens and
// signs out to the staff sign-in instead of failing panel by panel.
export const SESSION_ENDED_EVENT = 'ashantihub:session-ended'
// Fired instead for a 401 that ended no stored session (nothing was stored,
// or the 401 was for an older token). A staff shell that is mounted without
// a stored staff session — it ended while the staffer was on the marketplace
// — signs out on it rather than sitting there with every panel failing.
export const UNAUTHORIZED_EVENT = 'ashantihub:unauthorized'

export function getStoredAuth() {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function setStoredAuth(auth) {
  if (auth) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth))
  } else {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    lastStepUp = null
  }
}

// While a Super Admin is stepped into someone's workspace (lib/viewAs.js),
// reads also carry X-View-As, and writes and downloads are never sent:
// refuseWhileViewing throws the server's own 403 view_only instead.
function authHeaders(path) {
  const auth = getStoredAuth()
  return auth?.token ? { Authorization: `Bearer ${auth.token}`, ...viewAsHeaders(path, auth.token) } : {}
}

function refuseWhileViewing(path) {
  const refused = viewOnlyRefusal(path, getStoredAuth()?.token)
  if (refused) throw refused
}

// Every API call goes through here so the network-status store (and the
// staff OfflineBanner) learns about real connectivity: a fetch that rejects
// has no HTTP response at all — DNS/TLS failure, dead uplink, captive portal —
// which navigator.onLine often misses. Any response, whatever its status,
// proves the API is reachable. The original error is rethrown unchanged.
const sentAuth = new WeakMap()

async function request(path, init) {
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init)
  } catch (error) {
    reportApiNetworkFailure()
    throw error
  }
  reportApiResponse()
  sentAuth.set(response, init?.headers?.Authorization || null)
  return response
}

// Password re-entry (staff foundations F9). The staff shell registers a
// handler (SudoPrompt) that asks for the password; a 403 {code:
// "sudo_required"} then prompts and retries the request once. With no
// handler, or if the prompt is cancelled, the 403 surfaces as usual. The init
// is rebuilt for the retry so it re-reads the token.
let sudoHandler = null

export function setSudoHandler(handler) {
  sudoHandler = handler
  return () => {
    if (sudoHandler === handler) sudoHandler = null
  }
}

// Code step-up (OTP). A 403 {code: "step_up_required", action} asks the one
// registered handler (StepUpPrompt) for a code; it resolves {token, expiresIn}
// (seconds) or null when the person cancels. The request is then retried once
// with X-Step-Up-Token. A cancel, a second step_up_required or no handler
// leaves the 403 as it was. Independent of sudo: one request may need both.
let stepUpHandler = null

export function setStepUpHandler(handler) {
  stepUpHandler = handler
  return () => {
    if (stepUpHandler === handler) stepUpHandler = null
  }
}

// A token the retried request used but the server refused for another reason
// (a 400 validation error keeps the token alive server-side) is remembered so
// the person's corrected resubmit does not ask for a second code. It is only
// ever sent to the same method and path, and is cleared by any 2xx, by a
// step_up_required answer, on expiry and on sign-out.
let lastStepUp = null

async function refusalCode(response) {
  if (response.status !== 403) return {}
  try {
    return (await response.clone().json()) || {}
  } catch {
    return {}
  }
}

async function send(path, makeInit) {
  const method = makeInit().method || 'GET'
  if (lastStepUp && Date.now() >= lastStepUp.expiresAt) lastStepUp = null
  let token = lastStepUp?.method === method && lastStepUp.path === path ? lastStepUp.token : null
  let prompted = null
  const build = () => {
    const init = makeInit()
    return token ? { ...init, headers: { ...init.headers, 'X-Step-Up-Token': token } } : init
  }
  let response = await request(path, build())
  let sudoTried = false
  let stepUpTried = false
  while (response.status === 403) {
    const body = await refusalCode(response)
    if (body.code === 'sudo_required' && sudoHandler && !sudoTried) {
      sudoTried = true
      if (!(await sudoHandler())) break
    } else if (body.code === 'step_up_required' && stepUpHandler && !stepUpTried) {
      stepUpTried = true
      if (lastStepUp?.method === method && lastStepUp.path === path) lastStepUp = null
      token = null
      const answer = await stepUpHandler(body.action)
      if (!answer?.token) break
      token = answer.token
      prompted = { method, path, token, expiresAt: Date.now() + (answer.expiresIn || 300) * 1000 }
    } else {
      break
    }
    response = await request(path, build())
  }
  // Only an answer for the remembered method and path may clear it; an
  // unrelated request (a background refetch) must not cost a second code.
  const sameRequest = lastStepUp?.method === method && lastStepUp.path === path
  if (response.ok) {
    if (sameRequest) lastStepUp = null
  } else if ((await refusalCode(response)).code === 'step_up_required') {
    if (sameRequest) lastStepUp = null
  } else if (prompted) {
    lastStepUp = prompted
  }
  return response
}

// Every helper (apiDownload too) handles a 401 the same way.
function noteUnauthorized(response) {
  if (response.status !== 401) return
  // Only the session this request was sent with ends; a stale 401 must not
  // sign out a newer session (another sign-in, another tab).
  const stored = getStoredAuth()
  const sent = sentAuth.get(response)
  const hadSession = Boolean(stored) && sent === `Bearer ${stored.token}`
  if (hadSession || !stored) setStoredAuth(null)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(hadSession ? SESSION_ENDED_EVENT : UNAUTHORIZED_EVENT))
}

async function handleResponse(response, path) {
  noteUnauthorized(response)
  if (!response.ok) {
    // Attach the raw status + (best-effort) parsed JSON body onto the thrown
    // Error so a caller that needs to distinguish *why* a request failed
    // (e.g. EventDetailPage's RSVP flow telling a 400 "at capacity" apart
    // from any other error) can do so without every apiPost/apiDelete call
    // site re-implementing response parsing. Falls back to `body: null` for
    // a non-JSON or empty error body — callers must not assume it's present.
    let body = null
    try {
      body = await response.clone().json()
    } catch {
      // No JSON body (e.g. a plain 404/401) — leave body as null.
    }
    const error = new Error(`API request to ${path} failed with status ${response.status}`)
    error.status = response.status
    error.body = body
    throw error
  }
  // 204 No Content (e.g. DELETE /api/cart/items/{id}/) has no body to parse.
  if (response.status === 204) return null
  return response.json()
}

export async function apiFetch(path) {
  const response = await send(path, () => ({ headers: authHeaders(path) }))
  return handleResponse(response, path)
}

// Authenticated file download (the business sales CSV, staff report
// exports): fetches with the auth header — which a plain <a download> can't
// send — and saves the body as `filename`. A 202 means the server queued the
// file to build in the background: nothing is saved and the JSON body
// ({id, status}) is returned instead.
export async function apiDownload(path, filename) {
  refuseWhileViewing(path)
  const response = await send(path, () => ({ headers: authHeaders(path) }))
  if (response.status === 202) return response.json()
  noteUnauthorized(response)
  if (!response.ok) {
    let body = null
    try {
      body = await response.clone().json()
    } catch {
      // Not JSON — leave body null.
    }
    const error = new Error(`Download of ${path} failed with status ${response.status}`)
    error.status = response.status
    error.body = body
    throw error
  }
  saveBlob(await response.blob(), filename)
  return null
}

export async function apiPost(path, body) {
  refuseWhileViewing(path)
  const response = await send(path, () => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(path) },
    body: JSON.stringify(body),
  }))
  return handleResponse(response, path)
}

export async function apiPatch(path, body) {
  refuseWhileViewing(path)
  const response = await send(path, () => ({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(path) },
    body: JSON.stringify(body),
  }))
  return handleResponse(response, path)
}

export async function apiPut(path, body) {
  refuseWhileViewing(path)
  const response = await send(path, () => ({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders(path) },
    body: JSON.stringify(body),
  }))
  return handleResponse(response, path)
}

export async function apiPostForm(path, formData) {
  refuseWhileViewing(path)
  const response = await send(path, () => ({
    method: 'POST',
    headers: authHeaders(path),
    body: formData,
  }))
  return handleResponse(response, path)
}

export async function apiPatchForm(path, formData) {
  refuseWhileViewing(path)
  const response = await send(path, () => ({
    method: 'PATCH',
    headers: authHeaders(path),
    body: formData,
  }))
  return handleResponse(response, path)
}

// `body` is optional: a few endpoints (the opening test-account allowlist) name what to delete in a JSON body.
export async function apiDelete(path, body) {
  refuseWhileViewing(path)
  const response = await send(path, () => ({
    method: 'DELETE',
    headers: body === undefined ? authHeaders(path) : { 'Content-Type': 'application/json', ...authHeaders(path) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
  return handleResponse(response, path)
}
