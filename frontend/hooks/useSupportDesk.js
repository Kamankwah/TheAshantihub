import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// Support's desk (messaging.manage). Query keys start with the names
// backend/realtime/publish.py invalidates: support-inbox, support-thread,
// support-canned, support-tags.

// GET /api/messaging/staff/?scope=mine|unassigned|all|past|snoozed|resolved&sort=&q=&mine=1&days=&page=
// Paginated ({count, results, counts, summary}); read data.results.
export function useSupportInbox({ scope, sort = '', q = '', mine = false, days = 7, page = 1 }) {
  const params = new URLSearchParams({ scope })
  if (sort) params.set('sort', sort)
  if (q.trim()) params.set('q', q.trim())
  if (mine) params.set('mine', '1')
  if (scope === 'resolved') params.set('days', String(days))
  if (page > 1) params.set('page', String(page))
  return useQuery({
    queryKey: ['support-inbox', params.toString()],
    queryFn: () => apiFetch(`/api/messaging/staff/?${params}`),
    placeholderData: keepPreviousData,
  })
}

// GET /api/messaging/staff/<id>/ — the whole thread: messages, internal notes and timeline events.
export function useSupportThread(id) {
  return useQuery({
    queryKey: ['support-thread', id],
    queryFn: () => apiFetch(`/api/messaging/staff/${id}/`),
    enabled: Boolean(id),
  })
}

// GET /api/messaging/staff/<id>/context/ — person, order, business, subscription, account manager.
export function useSupportContext(id) {
  return useQuery({
    queryKey: ['support-thread', id, 'context'],
    queryFn: () => apiFetch(`/api/messaging/staff/${id}/context/`),
    enabled: Boolean(id),
  })
}

// GET /api/messaging/staff/team/ — {me, agents: [{id, name, open, capacity, full, available, note}], capacity, round_robin}
export function useSupportTeam() {
  return useQuery({ queryKey: ['support-inbox', 'team'], queryFn: () => apiFetch('/api/messaging/staff/team/') })
}

// GET /api/messaging/staff/limits/ — time limits, business hours, capacity (read for the Past time limit table).
export function useSupportLimits() {
  return useQuery({ queryKey: ['support-inbox', 'limits'], queryFn: () => apiFetch('/api/messaging/staff/limits/') })
}

// The composer's canned replies for one thread, filled from its real records. Plain array.
export function useCannedForThread(id) {
  return useQuery({
    queryKey: ['support-canned', 'thread', id],
    queryFn: () => apiFetch(`/api/messaging/staff/canned/?conversation=${id}`),
    enabled: Boolean(id),
  })
}

// GET /api/messaging/staff/canned/?status=active|retired|all — the library, most used first. Plain array.
export function useCannedLibrary(status = 'active') {
  return useQuery({ queryKey: ['support-canned', 'library', status], queryFn: () => apiFetch(`/api/messaging/staff/canned/?status=${status}`) })
}

// GET /api/messaging/staff/canned/fields/ — [{name, code, hint}] for the field chips.
export function useCannedFields() {
  return useQuery({ queryKey: ['support-canned', 'fields'], queryFn: () => apiFetch('/api/messaging/staff/canned/fields/'), staleTime: 600000 })
}

// GET /api/messaging/staff/tags/?archived=1 — tags with open_now / last_30_days counts. Plain array.
export function useSupportTags(archived = false) {
  return useQuery({ queryKey: ['support-tags', archived ? 'archived' : 'live'], queryFn: () => apiFetch(`/api/messaging/staff/tags/${archived ? '?archived=1' : ''}`) })
}

// GET /api/support/staff/people/?q=&type= and /recent/ — the People screen (users.view). Plain arrays.
export function usePeopleLookup(q, type) {
  const text = q.trim()
  return useQuery({
    queryKey: ['support-people', 'lookup', text, type],
    queryFn: () => apiFetch(`/api/support/staff/people/?q=${encodeURIComponent(text)}&type=${type}`),
    enabled: text.length >= 2,
  })
}
export function usePeopleRecent() {
  return useQuery({ queryKey: ['support-people', 'recent'], queryFn: () => apiFetch('/api/support/staff/people/recent/') })
}

// GET /api/support/staff/customers/<id>/360/ or businesses/<id>/360/ — a Support-visible profile.
export function usePersonProfile(kind, id) {
  return useQuery({
    queryKey: ['support-people', 'profile', kind, id],
    queryFn: () => apiFetch(`/api/support/staff/${kind === 'business' ? 'businesses' : 'customers'}/${id}/360/`),
    enabled: Boolean(kind && id),
  })
}
