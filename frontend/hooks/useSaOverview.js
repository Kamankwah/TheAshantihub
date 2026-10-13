import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/operations/superadmin-overview/ — the Super Admin command center (Super Admin only).
// {now, kpis: {decisions: {waiting, escalated, open_everywhere}, staff_online: {online, active}, fraud_open,
//   reports_today: {submitted}, at_risk: {count, needs_attention}, service_issues},
//  waiting: [{id, title, kind, kind_label, target_label, maker, maker_role, amount, requires_sudo, created_at, due_at, escalation_level}],
//  teams: [{role, label, step_in, staff, online, work: [string], flag}],
//  platform: [{key, name, state: ok|down|configured|simulated|not_connected|not_tracked, detail}], not_tracked: [string]}
// The key starts with 'approval-counts' so a live approvals update (lib/realtime.js) refreshes it too.
export function useSaOverview() {
  return useQuery({
    queryKey: ['approval-counts', 'sa-overview'],
    queryFn: () => apiFetch('/api/operations/superadmin-overview/'),
    refetchInterval: 60000,
  })
}
