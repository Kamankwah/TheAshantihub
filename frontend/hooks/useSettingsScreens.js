import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// Super Admin Settings and later-phase Money screens (backend/core settings_views, commission tax-ruling).
// Every response carries only what the server can read or count; a thing it cannot is named, not valued.

// GET /api/integrations/ (system.view): {items: [{key, name, status: connected|simulated|not_connected, provider, summary, missing: [text], note}]}
export const useIntegrations = () => useQuery({ queryKey: ['integrations'], queryFn: () => apiFetch('/api/integrations/') })

// GET /api/system-health/ (system.view): {checked_at, headline, overall, checks: [{key, name, state, value, note}],
//   jobs: [{key, task, every, state, last_started_at, last_finished_at, took_ms, error}], simulated_payments, not_reported: [{name, why}]}
export const useSystemHealth = () => useQuery({ queryKey: ['system-health'], queryFn: () => apiFetch('/api/system-health/'), refetchInterval: 60000 })

// GET /api/promotion-prices/ (system.view): {set_in_code, items: [{kind, label, per_day}]}
export const usePromotionPrices = () => useQuery({ queryKey: ['promotion-prices'], queryFn: () => apiFetch('/api/promotion-prices/') })

// GET /api/payouts-overview/ (commission.view_all): commission lines by status, ticket money held/released/refunded,
//   payout_blocker (text or null) and not_recorded: [{name, why}]
export const usePayoutsOverview = () => useQuery({ queryKey: ['payouts-overview'], queryFn: () => apiFetch('/api/payouts-overview/') })

// GET /api/commission/tax-ruling/: {current|null, history, payout_blocked, blocked_message, can_record, options: [{value, label}]}
export const useTaxRuling = () => useQuery({ queryKey: ['commission-tax-ruling'], queryFn: () => apiFetch('/api/commission/tax-ruling/') })
