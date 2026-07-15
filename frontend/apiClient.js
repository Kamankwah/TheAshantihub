const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
const AUTH_STORAGE_KEY = 'ashantihub.auth'

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

async function handleResponse(response, path) {
  if (response.status === 401) {
    setStoredAuth(null)
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
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders() })
  return handleResponse(response, path)
}

export async function apiPost(path, body) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  return handleResponse(response, path)
}

export async function apiPatch(path, body) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  return handleResponse(response, path)
}

export async function apiPostForm(path, formData) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  })
  return handleResponse(response, path)
}

export async function apiPatchForm(path, formData) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: formData,
  })
  return handleResponse(response, path)
}

export async function apiDelete(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  return handleResponse(response, path)
}
