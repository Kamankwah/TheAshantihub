import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/approvals/rules/ — Approval rules & timers (needs approvals.manage_rules or approvals.view_all).
// {settings: {cosign_threshold, refund_threshold, campaign_threshold, remind_fraction, updated_at, updated_by,
//             defaults: {...same four}},
//  kinds: [{key, label, chain: [string], response_hours, default_hours, overridden, requires_sudo, has_amount}],
//  cosigners: [{id, full_name, email}], cosigner_named, cosigner_invites_pending, waiting_for_cosigner}
// Save with apiPatch('/api/approvals/rules/', {cosign_threshold?, refund_threshold?, campaign_threshold?,
// remind_fraction?, kinds: {key: hours | null}}); it asks for the password (sudo) and is audited.
// The key starts with 'approvals' so a live approvals update refreshes it too.
export function useApprovalRules() {
  return useQuery({ queryKey: ['approvals', 'rules'], queryFn: () => apiFetch('/api/approvals/rules/') })
}
