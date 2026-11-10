import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'
import { newSecureUuid } from '../lib/uuid.js'

// GET /api/messaging/conversations/ — the caller's own support
// conversations, full message thread included. Works for BOTH signed-in
// callers (Customer or BusinessOwner, scoped by their auth token) and
// anonymous guests (scoped by a browser-generated guest token passed as
// ?guest_token= — see getGuestToken below). No pagination_class on the
// backend view, so this is a plain unpaginated array — same convention as
// useOrders.js/useMyEvents.js, not the paginated-envelope shape the
// staff-facing useStaffMessagingQueue() has. Starting a new conversation
// and replying within one are plain apiPost calls inside the consuming
// component's handler, not hooks — same established mutation convention as
// everywhere else in this app. `enabled` mirrors useCart.js's convention —
// MessagingCenter passes false for a staff session, whose inbox is the
// admin MessagingPanel (this endpoint 403s staff).
export function useMyConversations(enabled = true, guestToken = null) {
  const suffix = guestToken ? `?guest_token=${encodeURIComponent(guestToken)}` : ''
  return useQuery({
    queryKey: ['my-conversations', guestToken],
    queryFn: () => apiFetch(`/api/messaging/conversations/${suffix}`),
    enabled,
  })
}

const GUEST_TOKEN_STORAGE_KEY = 'ashantihub.guest_token'
let memoryGuestToken = null

// The anonymous-guest identity for support chat: a random id generated once
// per browser and persisted in localStorage, sent with every guest
// messaging request. The token IS the credential (unguessable-URL trust
// model) — the backend has no registry of valid tokens, it just scopes
// conversations to whatever token created them.
export function getGuestToken() {
  // Runs during App render: it must never throw (old browsers lack crypto.randomUUID; storage can be blocked).
  let token = null
  try {
    token = localStorage.getItem(GUEST_TOKEN_STORAGE_KEY)
  } catch {
    // storage blocked — fall through to an in-memory token for this page load
  }
  if (!token) {
    // No CSPRNG in this browser: fail closed (no guest chat) rather than mint a guessable credential.
    token = memoryGuestToken || newSecureUuid()
    if (!token) return null
    memoryGuestToken = token
    try {
      localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, token)
    } catch {
      // kept in memory only
    }
  }
  return token
}
