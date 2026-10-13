// Step-in ("view as", Super Admin SA-6): the client side of the Super Admin's
// read-only view of a team member's workspace. The server holds the rules
// (backend/accounts/view_as.py): a started view on the Super Admin's own
// session, X-View-As honoured for reads only, every write refused 403
// {code: "view_only"}, one audit event per screen opened.
//
// This module only remembers three things, and apiClient.js reads them:
// - who is being viewed: per tab (sessionStorage), and bound to the sign-in
//   it was started under, so another sign-in in this tab never inherits it;
// - whether the stepped-in shell is mounted ("live"): only then do requests
//   carry X-View-As, so the marketplace and the Super Admin's own shell never
//   send it;
// - which screen is open in it (X-View-As-Screen) for the audit trail.
const STORAGE_KEY = 'ashantihub.viewAs'
// Fired when a write is stopped here; the banner says why nothing happened.
export const VIEW_ONLY_EVENT = 'ashantihub:view-only'
export const VIEW_ONLY_MESSAGE = "You are viewing someone else's workspace read-only, so nothing can be changed here."
// Always sent as the Super Admin: their own /me (useAuth must never read the
// person viewed) and the step-in endpoints. The person's /me is read through
// the view as /api/accounts/me/?viewing=1, which these do not match.
const SELF_PATHS = [/^\/api\/accounts\/me\/$/, /^\/api\/accounts\/staff\/view-as\//]

function load() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

let state = load()
let live = false
let screen = ''
const listeners = new Set()

function save(next) {
  try {
    if (next) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked: the view still works until this tab reloads.
  }
}

function emit() {
  listeners.forEach((listener) => listener())
}

// A short, non-secret fingerprint of the sign-in a view belongs to.
export function tokenTail(token) {
  return token ? String(token).slice(-24) : ''
}

export function subscribeViewAs(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// The stored view, whoever's sign-in it was (useSyncExternalStore snapshot).
export function getViewAsSnapshot() {
  return state
}

// The view started under this sign-in, or null.
export function viewFor(token) {
  return state && token && state.tokenTail === tokenTail(token) ? state : null
}

// `person` is the server's {id, full_name, role, role_label, team, manager}.
export function setViewAs(person, token, startedAt) {
  state = { person, tokenTail: tokenTail(token), startedAt: startedAt || null }
  save(state)
  emit()
}

export function clearViewAs() {
  state = null
  live = false
  screen = ''
  save(null)
  emit()
}

export function setViewAsLive(on) {
  live = Boolean(on)
}

export function setViewAsScreen(id) {
  screen = typeof id === 'string' ? id : ''
}

function activeFor(path, token) {
  return live && viewFor(token) && !SELF_PATHS.some((pattern) => pattern.test(path))
}

// Extra headers for a request to `path` signed with `token`.
export function viewAsHeaders(path, token) {
  if (!activeFor(path, token)) return {}
  return { 'X-View-As': String(state.person.id), ...(screen ? { 'X-View-As-Screen': screen } : {}) }
}

// A write (or a download) while viewing: never sent. The error has the same
// shape as the server's refusal, so panels show their usual error.
export function viewOnlyRefusal(path, token) {
  if (!activeFor(path, token)) return null
  const error = new Error(`API request to ${path} was not sent: viewing as someone else is read-only`)
  error.status = 403
  error.body = { code: 'view_only', detail: VIEW_ONLY_MESSAGE }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(VIEW_ONLY_EVENT))
  return error
}
