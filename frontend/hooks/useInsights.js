import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// Super Admin Insights and Money screens (backend/insights). Every key starts with
// 'insights' so one invalidation refreshes them all. Amounts are strings of Decimal GH₵.
const get = (key, path, enabled = true) => useQuery({ queryKey: ['insights', ...key], queryFn: () => apiFetch(path), enabled, placeholderData: keepPreviousData })
const qs = (params) => {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '' && v !== 'all') search.set(k, v) })
  const text = search.toString()
  return text ? `?${text}` : ''
}

// GET /api/insights/revenue/?from=&to=&zone=&category= (transactions.report)
export const useRevenue = (p) => get(['revenue', p], `/api/insights/revenue/${qs(p)}`)
// GET /api/insights/analytics/?zone= (analytics.view)
export const useSaAnalytics = (p) => get(['analytics', p], `/api/insights/analytics/${qs(p)}`)
// GET /api/insights/funnel/?team=&from=&to= (analytics.view)
export const useFunnel = (p) => get(['funnel', p], `/api/insights/funnel/${qs(p)}`)
// GET /api/insights/reports-hub/?period=&date=&role=&status=&person= (reports.view_all)
export const useReportsHub = (p) => useQuery({ queryKey: ['insights', 'reports-hub', p], queryFn: () => apiFetch(`/api/insights/reports-hub/${qs(p)}`), placeholderData: keepPreviousData, refetchInterval: 60000 })
// GET /api/insights/refunds/?from=&to=&source= (transactions.report)
export const useRefunds = (p) => get(['refunds', p], `/api/insights/refunds/${qs(p)}`)
// GET /api/insights/commissions/ (commission.view_all) and the accrual list behind it.
export const useCommissionsOverview = () => get(['commissions'], '/api/insights/commissions/')
export const useAccrualLines = (p) => get(['accruals', p], `/api/commission/accruals/${qs(p)}`)
// GET /api/insights/exports/ (exports.schedule): {schedules, kinds, team_options, kpis, staff}
export const useScheduledExports = () => get(['scheduled-exports'], '/api/insights/exports/')
// GET /api/insights/exports/<id>/runs/
export const useScheduleRuns = (id) => get(['scheduled-exports', 'runs', id], `/api/insights/exports/${id}/runs/`, id != null)
// GET /api/insights/exports/files/mine/ — files sent to me that are still valid.
export const useMyExportFiles = () => get(['export-files'], '/api/insights/exports/files/mine/')
