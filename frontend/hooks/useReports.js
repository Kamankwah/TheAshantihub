import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/reports/current/ — my report for a period: the saved one, or an
// unsaved draft (id null) with live system numbers. A plain object.
export function useCurrentReport(period, date) {
  return useQuery({
    queryKey: ['report', 'current', period, date],
    queryFn: () => apiFetch(`/api/reports/current/?period=${period}&date=${date}`),
  })
}

// GET /api/reports/?period= — my report history, a DRF page (data?.results).
export function useMyReports(period) {
  return useQuery({ queryKey: ['my-reports', period], queryFn: () => apiFetch(`/api/reports/?period=${period}`) })
}

// GET /api/reports/team/ — {period, period_start, rows: [{staff, report|null}]}.
export function useTeamReports(period, date, scope = 'team') {
  const everyone = scope === 'all' ? '&scope=all' : ''
  return useQuery({
    queryKey: ['team-reports', period, date, scope],
    queryFn: () => apiFetch(`/api/reports/team/?period=${period}&date=${date}${everyone}`),
  })
}

// GET /api/reports/<id>/ — one report with its system numbers.
export function useReport(id) {
  return useQuery({ queryKey: ['report', String(id)], queryFn: () => apiFetch(`/api/reports/${id}/`), enabled: id != null })
}

// Poll every 10 s while any export is still being built; stop once all settle.
export function exportsRefetchInterval(query) {
  const rows = query.state.data
  return Array.isArray(rows) && rows.some((row) => row.status === 'queued' || row.status === 'running') ? 10000 : false
}

// GET /api/reports/exports/ — my background exports, a plain array.
export function useReportExports() {
  return useQuery({ queryKey: ['report-exports'], queryFn: () => apiFetch('/api/reports/exports/'), refetchInterval: exportsRefetchInterval })
}
