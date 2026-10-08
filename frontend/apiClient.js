import { saveBlob } from './lib/saveBlob.js'
import { reportApiNetworkFailure, reportApiResponse } from './lib/networkStatus.js'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
const AUTH_STORAGE_KEY = 'ashantihub.auth'
// Fired when the API answers 401 for a signed-in session (an ended, idle or
// expired staff session, or a revoked token). The staff shell listens and
// signs out to the staff sign-in instead of failing panel by panel.
export const SESSION_ENDED_EVENT = 'ashantihub:session-ended'

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
  }
}

function authHeaders() {
  const auth = getStoredAuth()
  return auth?.token ? { Authorization: `Bearer ${auth.token}` } : {}
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

async function send(path, makeInit) {
  let response = await request(path, makeInit())
  if (response.status === 403 && sudoHandler) {
    let body = null
    try {
      body = await response.clone().json()
    } catch {
      body = null
    }
    if (body?.code === 'sudo_required' && (await sudoHandler())) {
      response = await request(path, makeInit())
    }
  }
  return response
}

async function handleResponse(response, path) {
  if (response.status === 401) {
    // Only the session this request was sent with ends; a stale 401 must not
    // sign out a newer session (another sign-in, another tab).
    const stored = getStoredAuth()
    const sent = sentAuth.get(response)
    const hadSession = Boolean(stored) && sent === `Bearer ${stored.token}`
    if (hadSession || !stored) setStoredAuth(null)
    if (hadSession && typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_ENDED_EVENT))
  }
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
  const response = await send(path, () => ({ headers: authHeaders() }))
  return handleResponse(response, path)
}

// Authenticated file download (the business sales CSV, staff report
// exports): fetches with the auth header — which a plain <a download> can't
// send — and saves the body as `filename`. A 202 means the server queued the
// file to build in the background: nothing is saved and the JSON body
// ({id, status}) is returned instead.
export async function apiDownload(path, filename) {
  const response = await send(path, () => ({ headers: authHeaders() }))
  if (response.status === 202) return response.json()
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
  const response = await send(path, () => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  }))
  return handleResponse(response, path)
}

export async function apiPatch(path, body) {
  const response = await send(path, () => ({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  }))
  return handleResponse(response, path)
}

export async function apiPostForm(path, formData) {
  const response = await send(path, () => ({
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  }))
  return handleResponse(response, path)
}

export async function apiPatchForm(path, formData) {
  const response = await send(path, () => ({
    method: 'PATCH',
    headers: authHeaders(),
    body: formData,
  }))
  return handleResponse(response, path)
}

export async function apiDelete(path) {
  const response = await send(path, () => ({
    method: 'DELETE',
    headers: authHeaders(),
  }))
  return handleResponse(response, path)
}
