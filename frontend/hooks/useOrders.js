import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

const POLL_MS = 30000
const ON_THE_ROAD = ['assigned', 'accepted', 'at_pickup', 'picked_up', 'at_customer']

// Poll only while one of the caller's orders has a rider on an unfinished delivery, so the
// delivery code box and the status follow the job without a reload. Pure, for unit tests.
export function customerOrdersInterval(data) {
  const active = Array.isArray(data) && data.some((o) => ON_THE_ROAD.includes(o.delivery_assignment_status))
  return active ? POLL_MS : false
}

// GET /api/orders/ — the caller's own past orders (docs/BUSINESS_EVENTS_ROADMAP.md
// Phase 4). Checkout itself (POST /api/orders/checkout/) is a one-shot
// mutation, not a query — no dedicated hook for it, matching this codebase's
// established "plain apiPost call inside the consuming handler" convention
// (see CLAUDE.md's Commands/Architecture notes on BusinessDashboard's saveEdit).
export function useOrders() {
  return useQuery({
    queryKey: ['orders'],
    queryFn: () => apiFetch('/api/orders/'),
    refetchInterval: (query) => customerOrdersInterval(query.state.data),
    refetchIntervalInBackground: false,
  })
}
