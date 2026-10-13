import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// Marketing's consent ledger (screen 07) and segments (screen 06).

// GET /api/marketing/consent/summary/ — {channels: [{channel, label, opted_in, opted_out, joined_this_week, left_this_week}],
//   total_records, first_record_at, opt_outs_7d: {total, by_source: [{source, label, count}]}, retention: {years, records_due}}
export function useConsentSummary() {
  return useQuery({ queryKey: ['marketing-consent-summary'], queryFn: () => apiFetch('/api/marketing/consent/summary/') })
}

// GET /api/marketing/consent/ledger/?contact&channel&status&source&page — DRF page of lines
//   {id, who, kind_label, phone (masked), email (masked), channel, channel_label, status, source_label, source_detail,
//    wording, wording_text, at, device, recorded_by}
export function useConsentLedger(filters, page) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value) })
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return useQuery({
    queryKey: ['marketing-consent-ledger', filters, page],
    queryFn: () => apiFetch(`/api/marketing/consent/ledger/${query ? `?${query}` : ''}`),
    placeholderData: keepPreviousData,
  })
}

// GET /api/marketing/consent/wordings/ — {wordings: [{id, label, channel_label, audience, text, live_from, retired_at, records}]}
export function useConsentWordings() {
  return useQuery({ queryKey: ['marketing-consent-wordings'], queryFn: () => apiFetch('/api/marketing/consent/wordings/') })
}

// GET /api/marketing/segments/options/ — {zones, categories, activities: {customer: [{key,label}], business_owner: [...]}, channels, audiences, zone_note}
export function useSegmentOptions() {
  return useQuery({ queryKey: ['marketing-segment-options'], queryFn: () => apiFetch('/api/marketing/segments/options/'), staleTime: 5 * 60 * 1000 })
}

// GET /api/marketing/segments/ — {results: [{id, name, audience, audience_label, channel, channel_label, filters, rules, size, last_used}]}
export function useSegments() {
  return useQuery({ queryKey: ['marketing-segments'], queryFn: () => apiFetch('/api/marketing/segments/') })
}

// The account's own marketing choices (customer and business settings):
// GET /api/marketing/consent/me/ — {channels: {sms|whatsapp|email|inapp: {label, status: opted_in|opted_out|null, at, wording}}}
export function useMyConsent(enabled = true) {
  return useQuery({ queryKey: ['marketing-my-consent'], queryFn: () => apiFetch('/api/marketing/consent/me/'), enabled })
}
