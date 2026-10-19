import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// The Delivery Manager's screens (backend/delivery). Every query key starts with the
// name the server's live-update rows send (backend/realtime/publish.py), so a rider's
// step refreshes the board without a reload. Reads fall back to a slow poll when no
// socket is open.
const qs = (params = {}) => {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '' && v !== 'all') search.set(k, v) })
  const text = search.toString()
  return text ? `?${text}` : ''
}
const get = (key, path, { poll = 0, enabled = true } = {}) => useQuery({
  queryKey: key, queryFn: () => apiFetch(path), enabled, placeholderData: keepPreviousData, refetchInterval: poll || false,
})

// GET /api/delivery/live/ (delivery.manage): KPIs, rider pins with fix age, queue, needs-you, open cases.
export const useDeliveryLive = () => get(['delivery-live'], '/api/delivery/live/', { poll: 30000 })
// GET /api/delivery/queue/ — waiting orders, most urgent first, with the engine's pick.
export const useDeliveryDispatchQueue = () => get(['delivery-queue', 'list'], '/api/delivery/queue/', { poll: 30000 })
// GET /api/delivery/scheduled/?page= — paid orders held until their vendors open, soonest first. PAGINATED
// ({count, next, previous, results}): read `data?.results`, not `data`. Same live-update key as the server's early-send row.
export const useDeliveryScheduled = (page = 1) => get(['delivery-scheduled', page], `/api/delivery/scheduled/${qs({ page: page > 1 ? page : '' })}`, { poll: 60000 })
// GET /api/delivery/queue/<order>/ranking/ — score breakdown for one order.
export const useQueueRanking = (orderId) => get(['delivery-queue', 'ranking', orderId], `/api/delivery/queue/${orderId}/ranking/`, { enabled: orderId != null })
// GET /api/delivery/active/?filter=
export const useDeliveryActive = (filter = 'all') => get(['delivery-active', filter], `/api/delivery/active/${qs({ filter })}`, { poll: 30000 })
// GET /api/delivery/jobs/<id>/
export const useDeliveryJob = (id) => get(['delivery-job', id], `/api/delivery/jobs/${id}/`, { enabled: id != null })
// GET /api/delivery/cases/?type=&status=open|closed
export const useDeliveryCases = (params) => get(['delivery-cases', 'list', params], `/api/delivery/cases/${qs(params)}`, { poll: 60000 })
// GET /api/delivery/cases/<id>/
export const useDeliveryCase = (id) => get(['delivery-case', id], `/api/delivery/cases/${id}/`, { enabled: id != null })

// Fleet (delivery.fleet)
export const useDeliveryRiders = (params) => get(['delivery-riders', 'list', params], `/api/delivery/riders/${qs(params)}`, { poll: 60000 })
export const useDeliveryRider = (id) => get(['delivery-rider', id], `/api/delivery/riders/${id}/`, { enabled: id != null })
export const useDeliveryDocuments = (bucket = 'waiting') => get(['delivery-documents', bucket], `/api/delivery/documents/${qs({ bucket })}`)
export const useDeliveryVehicles = () => get(['delivery-vehicles'], '/api/delivery/vehicles/')
export const useDeliveryZones = () => get(['delivery-zones'], '/api/delivery/zones/')
export const useDeliveryInvites = () => get(['delivery-invites'], '/api/delivery/invites/')
export const useDeliveryShifts = (params) => get(['delivery-shifts', params], `/api/delivery/shifts/${qs(params)}`)

// Cash and pay (delivery.cash / delivery.rates)
export const useDeliveryCash = () => get(['delivery-cash'], '/api/delivery/cash/')
export const useDeliveryPayouts = (weeks = 2) => get(['delivery-payouts', weeks], `/api/delivery/payouts/${qs({ weeks })}`)
export const useDeliveryPayoutLines = (staffId, weeks = 2) => get(['delivery-payouts', 'lines', staffId, weeks], `/api/delivery/payouts/${staffId}/${qs({ weeks })}`, { enabled: staffId != null })

// Settings (delivery.rates)
export const useAutoAssignRules = () => get(['delivery-rules', 'auto-assign'], '/api/delivery/rules/auto-assign/')
export const useTimeLimits = () => get(['delivery-rules', 'time-limits'], '/api/delivery/rules/time-limits/')
export const useRateCard = () => get(['delivery-rules', 'rate-card'], '/api/delivery/rules/rate-card/')

// Rider app (delivery.dispatch): the caller's own data.
export const useRiderMe = () => get(['delivery-rider-me'], '/api/delivery/rider/me/', { poll: 30000 })
export const useRiderOffers = (enabled = true) => get(['delivery-rider-offers'], '/api/delivery/rider/offers/', { poll: 8000, enabled })
export const useRiderJobs = (scope = 'active') => get(['delivery-rider-jobs', scope], `/api/delivery/rider/jobs/${qs({ scope })}`, { poll: 30000 })
export const useRiderJob = (id) => get(['delivery-rider-jobs', 'one', id], `/api/delivery/rider/jobs/${id}/`, { enabled: id != null, poll: 15000 })
export const useRiderShifts = () => get(['delivery-rider-shifts'], '/api/delivery/rider/shifts/')
export const useRiderDocuments = () => get(['delivery-rider-documents'], '/api/delivery/rider/documents/')
export const useRiderEarnings = (period = 'week') => get(['delivery-rider-earnings', period], `/api/delivery/rider/earnings/${qs({ period })}`)
export const useRiderCash = () => get(['delivery-rider-cash'], '/api/delivery/rider/cash/')
