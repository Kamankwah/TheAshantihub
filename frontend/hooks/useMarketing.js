import { useQuery } from '@tanstack/react-query'
import { apiFetch, apiPost } from '../apiClient.js'

// Marketing foundation (canvas screens 01 Overview and 20 Quiet hours & limits).
// Later packages keep their hooks in their own files (useMarketingCampaigns.js, ...).
// Query keys start with 'marketing-' so backend/realtime/publish.py can name them.

// GET /api/marketing/overview/?days=7|30 — {now, days, since, channels: [{key, name, status, provider, summary}],
//   messages|opt_ins|orders|coupons|banners: {state: 'not_tracked'|'ok', note?, ...figures},
//   promotions: {amount, count, businesses}, scheduled_next: [{at, kind, what, status, tone}],
//   queues: [{key, title, count, oldest}], waiting_on_others: [{id, title, created_at, kind, waiting_on}],
//   policy, threshold, simulated_payments}
export function useMarketingOverview(days = 7) {
  return useQuery({ queryKey: ['marketing-overview', days], queryFn: () => apiFetch(`/api/marketing/overview/?days=${days}`) })
}

// GET /api/marketing/policy/ — {policy: {window_start, window_end, send_days, send_day_names, per_person_cap_days,
//   quiet_public_holidays, timezone, updated_at, updated_by}, threshold, pending: {id, title, maker, created_at, payload}|null,
//   history: [{at, kind: 'applied'|'rejected', who, before, after, note?}], can_propose, weekday_names, limits}
export function useMarketingPolicy() {
  return useQuery({ queryKey: ['marketing-policy'], queryFn: () => apiFetch('/api/marketing/policy/') })
}

// POST /api/marketing/policy/ — propose a change; goes to Super Admin (a Super Admin's own applies at once).
export const proposeMarketingPolicy = (body) => apiPost('/api/marketing/policy/', body)
