import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// Delivery map and tracking payloads (backend/delivery/tracking.py). Each audience has its own
// endpoint and the server decides what it may see. They refresh every 15 s while the tab is
// visible; a hidden tab does not poll.
const useTrack = (key, path, enabled = true) => useQuery({
  queryKey: key, placeholderData: keepPreviousData, queryFn: () => apiFetch(path), enabled,
  refetchInterval: 15000, refetchIntervalInBackground: false,
})

// GET /api/delivery/queue/<order>/map/ — pickup, drop, trip, route and candidate riders.
export const useQueueMap = (orderId) => useTrack(['track-queue', orderId], `/api/delivery/queue/${orderId}/map/`, orderId != null)
// GET /api/delivery/jobs/<id>/map/ — the delivery manager's view of one job.
export const useJobMap = (jobId) => useTrack(['track-job', jobId], `/api/delivery/jobs/${jobId}/map/`, jobId != null)
// GET /api/orders/dispatch/<id>/map/ — the dispatcher's view of one job.
export const useDispatchMap = (jobId) => useTrack(['track-dispatch', jobId], `/api/orders/dispatch/${jobId}/map/`, jobId != null)
// GET /api/orders/<id>/tracking/ — the customer's view of their order.
export const useOrderTracking = (orderId, { enabled = true } = {}) => useTrack(['track-order', orderId], `/api/orders/${orderId}/tracking/`, enabled && orderId != null)
// GET /api/orders/owner/<id>/tracking/ — the business's view; only the pickup business sees the rider.
export const useOwnerOrderTracking = (orderId, { enabled = true } = {}) => useTrack(['track-owner-order', orderId], `/api/orders/owner/${orderId}/tracking/`, enabled && orderId != null)
