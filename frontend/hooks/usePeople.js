import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'
import { queryString } from './useMarketplace.js'

// Super Admin People screens (SA-4). Every key starts with 'staff-roster' so the
// live update that already refreshes the roster (staff invites, suspensions,
// manager and role changes, role-matrix saves) refreshes these too.

// GET /api/people/staff/?q=&role=&manager=&status=&two_step=&last_sign_in=&page=
// -> page of {id, name, email, role, role_label, manager, areas, reports, status, status_note,
//    invite_expires_at, on_leave_to, last_sign_in_at, two_step (on|off|null), two_step_required}
export function useStaffDirectory(params = {}, { enabled = true } = {}) {
  const q = queryString(params)
  return useQuery({
    queryKey: ['staff-roster', 'directory', q],
    queryFn: () => apiFetch(`/api/people/staff/${q ? `?${q}` : ''}`),
    placeholderData: keepPreviousData,
    enabled,
  })
}

// GET /api/people/staff/counts/ -> {all, active, invited, invite_expired, suspended, deactivated,
//    by_role: [{role, label, active, ..., total}], two_step: {on, active}, managers: [{id, name, role}],
//    worth_a_look: [{kind, staff, name, text}]}
export function useStaffDirectoryCounts() {
  return useQuery({ queryKey: ['staff-roster', 'directory-counts'], queryFn: () => apiFetch('/api/people/staff/counts/') })
}

// GET /api/people/staff/<id>/ -> the profile read (identity, live, performance, permissions, sessions,
//    reports, approvals, pay). Activity and commission lines come from their own endpoints.
export function useStaffProfile(id) {
  return useQuery({
    queryKey: ['staff-roster', 'profile', id],
    queryFn: () => apiFetch(`/api/people/staff/${id}/`),
    enabled: id != null,
  })
}

// GET /api/people/teams/ -> {people, teams, tree: [node{id, name, role, role_label, status, areas, can_lead, children}],
//    leads, history}
export function useOrgChart() {
  return useQuery({ queryKey: ['staff-roster', 'teams'], queryFn: () => apiFetch('/api/people/teams/') })
}

// GET /api/people/invites/ -> {link_days, kpis, invites, recent, roles, leads, who_can_invite}
export function useSaInvites() {
  return useQuery({ queryKey: ['staff-roster', 'invites'], queryFn: () => apiFetch('/api/people/invites/') })
}

// GET /api/people/roles/ -> {roles: [{name, label, locked, people, grants, revokes}],
//    groups: [{name, permissions: [{codename, description, roles: {role: bool}, locked_for: {role: why}}]}], permission_count}
export function useRoleMatrix() {
  return useQuery({ queryKey: ['staff-roster', 'roles'], queryFn: () => apiFetch('/api/people/roles/') })
}

// GET /api/people/sessions/ -> {kpis, rules, sessions}
export function useSessionsOverview() {
  return useQuery({ queryKey: ['staff-roster', 'sessions'], queryFn: () => apiFetch('/api/people/sessions/') })
}

// GET /api/activity/?actor=<id> — one person's recent actions (activity.view_all).
export function usePersonActivity(id, enabled = true) {
  return useQuery({
    queryKey: ['staff-roster', 'activity', id],
    queryFn: () => apiFetch(`/api/activity/?actor=${id}`),
    enabled: enabled && id != null,
  })
}

// GET /api/commission/accruals/?staff=<id> — that person's commission lines (commission.view_all).
export function usePersonCommission(id, enabled = true) {
  return useQuery({
    queryKey: ['staff-roster', 'commission', id],
    queryFn: () => apiFetch(`/api/commission/accruals/?staff=${id}`),
    enabled: enabled && id != null,
  })
}
