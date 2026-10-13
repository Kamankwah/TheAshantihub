import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// Campaign screens (canvas 02-05, 18, 19). Query keys start with 'marketing-'.

// GET /api/marketing/campaigns/?status=&channel= — {results: [campaign], total, tabs: {draft, waiting_approval, scheduled, sent},
//   sms_month_estimate, sms_balance: null, sms_note}. A campaign: {id, name, channel, channel_label, status, status_label,
//   segment_name, est_recipients, est_cost|null, cost_known, send_at, sent_at, note, results|null, free_channel}
export function useCampaigns({ status = '', channel = '' } = {}) {
  const query = new URLSearchParams()
  if (status) query.set('status', status)
  if (channel) query.set('channel', channel)
  return useQuery({ queryKey: ['marketing-campaigns', status, channel], queryFn: () => apiFetch(`/api/marketing/campaigns/${query.size ? `?${query}` : ''}`) })
}

// GET /api/marketing/campaigns/<id>/ — a campaign plus subject, body, link_path, template, preview, checks, trail, editable, needs_approval, threshold, provider
export function useCampaign(id) {
  return useQuery({ queryKey: ['marketing-campaign', id], enabled: !!id && id !== 'new', queryFn: () => apiFetch(`/api/marketing/campaigns/${id}/`) })
}

// GET /api/marketing/calendar/?from=&to= — {entries: [{id, kind: message|banner|flash_sale, channel?, title, starts_at, ends_at, status}], quiet_days: [{date, why}], clashes: [{when, text}], window}
export function useMarketingCalendar(from, to) {
  return useQuery({ queryKey: ['marketing-calendar', from, to], queryFn: () => apiFetch(`/api/marketing/calendar/?from=${from}&to=${to}`) })
}

// GET /api/marketing/templates/ — {sms: [template], whatsapp: [template], whatsapp_counts, whatsapp_provider, sms_provider, stop_footer_length}
export function useTemplates() {
  return useQuery({ queryKey: ['marketing-templates'], queryFn: () => apiFetch('/api/marketing/templates/') })
}

// GET /api/marketing/providers/ — {sms, senders: [{name, length, used_for, networks: {mtn: {...}}}], networks, whatsapp: {steps, done, ...}, email: {facts}, inapp}
export function useProviders() {
  return useQuery({ queryKey: ['marketing-providers'], queryFn: () => apiFetch('/api/marketing/providers/') })
}

// GET /api/marketing/results/campaigns/ — {results: [{id, name, channel, sent_at, send_at}]}
export function useResultsList() {
  return useQuery({ queryKey: ['marketing-results-list'], queryFn: () => apiFetch('/api/marketing/results/campaigns/') })
}

// GET /api/marketing/campaigns/<id>/results/ — see backend/marketing/views_campaigns.py CampaignResultsView
export function useCampaignResults(id) {
  return useQuery({ queryKey: ['marketing-campaign-results', id], enabled: !!id, queryFn: () => apiFetch(`/api/marketing/campaigns/${id}/results/`) })
}
