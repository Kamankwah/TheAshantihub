import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/orders/ — the caller's own past orders (docs/BUSINESS_EVENTS_ROADMAP.md
// Phase 4). Checkout itself (POST /api/orders/checkout/) is a one-shot
// mutation, not a query — no dedicated hook for it, matching this codebase's
// established "plain apiPost call inside the consuming handler" convention
// (see CLAUDE.md's Commands/Architecture notes on BusinessDashboard's saveEdit).
export function useOrders() {
  return useQuery({
    queryKey: ['orders'],
    queryFn: () => apiFetch('/api/orders/'),
  })
}
