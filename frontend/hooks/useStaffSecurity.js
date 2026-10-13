import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

const query = (params) => new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== '' && v != null)).toString()

// GET /api/staff-security/sign-ins/?kind=a,b&staff=&since=&until=&page= (needs security.manage)
//   {count, page, has_next, results: [{id, at, kind, kind_label, who: {id, name, role} | null, identifier (masked),
//    two_factor, note, ip, device}], history_starts (ISO | null), summary: {signed_in_24h, refused_24h,
//    two_step_failed_24h, signed_in_now}, failed_recent: [{kind, who, identifier, attempts}], people: [{id, full_name}]}
export function useSignInHistory(params) {
  const q = query(params)
  return useQuery({ queryKey: ['staff-security', 'sign-ins', q], queryFn: () => apiFetch(`/api/staff-security/sign-ins/?${q}`), placeholderData: keepPreviousData })
}

// GET /api/staff-security/exports/?actor=&personal=yes|no|unknown&since=&until=&page= (needs activity.view_all)
//   {count, page, has_next, results: [{id, at, who, role, scheduled, what, filters, format, rows, personal_data (bool | null),
//    link_state, link}], summary: {last_30_days, personal_30_days, scheduled_30_days, not_recorded_30_days},
//    people: [{actor_id, actor_label}]}
export function useExportsLog(params) {
  const q = query(params)
  return useQuery({ queryKey: ['staff-security', 'exports', q], queryFn: () => apiFetch(`/api/staff-security/exports/?${q}`), placeholderData: keepPreviousData })
}

// GET /api/staff-security/policy/ (needs security.manage)
//   {roles: [{name, label, people, using, required, locked}], limits: {idle_minutes, absolute_hours, password_window_minutes},
//    password_protected: [{title, body}], updated_at, updated_by, other_super_admins}
// Save with apiPatch('/api/staff-security/policy/', {two_factor_roles: [role names]}); it asks for the password.
export function useSecurityPolicy(enabled = true) {
  return useQuery({ queryKey: ['staff-security', 'policy'], queryFn: () => apiFetch('/api/staff-security/policy/'), enabled })
}

// GET /api/notifications/?kinds=1&kind=a,b&unread=1&limit=200 — the signed-in person's notifications:
//   {unread_count, results: [{id, kind, title, body, link, icon, is_read, created_at}], kinds: [{kind, total}]}
// `link` is a staff screen id. Marking read is apiPost on /api/notifications/<id>/read/ and /read-all/.
export function useNotificationCenter(params) {
  const q = query({ kinds: '1', limit: '200', ...params })
  return useQuery({ queryKey: ['notifications', 'center', q], queryFn: () => apiFetch(`/api/notifications/?${q}`), placeholderData: keepPreviousData })
}

// GET /api/announcements/ (needs announcements.send)
//   {announcements: [{id, title, body, status, to, roles, team_manager, require_confirm, send_email, send_at, sent_at,
//    created_at, created_by, recipients, emailed, opened, confirmed, not_opened, last_reminded_at}],
//    roles: [{name, label, people}], teams: [{id, name, people}], channels: {in_app, email, push, sms, whatsapp}}
// Compose with apiPost('/api/announcements/', {title, body, roles, team_manager, require_confirm, send_email, when: now|schedule|draft, send_at}).
export function useAnnouncements() {
  return useQuery({ queryKey: ['announcements'], queryFn: () => apiFetch('/api/announcements/') })
}

// GET /api/announcements/<id>/ — one announcement and {people: [{id, name, role, opened_at, confirmed_at}]}.
export function useAnnouncement(id) {
  return useQuery({ queryKey: ['announcements', 'one', id], queryFn: () => apiFetch(`/api/announcements/${id}/`), enabled: Boolean(id) })
}

// GET /api/announcements/mine/ — [{id, title, body, sent_at, from, require_confirm}]: notices waiting for me.
// Opened with apiPost('/api/announcements/mine/<id>/open/'), confirmed with '.../confirm/'. Polled once a minute.
export function useMyAnnouncements(enabled = true) {
  return useQuery({ queryKey: ['announcements', 'mine'], queryFn: () => apiFetch('/api/announcements/mine/'), enabled, refetchInterval: 60000 })
}
