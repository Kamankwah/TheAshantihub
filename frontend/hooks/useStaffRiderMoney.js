import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// Staff (wallets.view) reads of third-party rider money. Neither has a realtime
// key; both refetch on window focus and when the panel's Refresh invalidates them.
// ledger_off and wallet_disabled (a rider who never had wallet money) do not
// change by asking again, so neither is retried.
function retryUnlessWalletOff(failureCount, error) {
  const code = error?.body?.code
  return code !== 'ledger_off' && code !== 'wallet_disabled' && failureCount < 2
}

// GET /api/delivery/riders/<id>/wallet/ -> {rider{id, staff_id, name, employment,
// company_name, third_party_since}, the rider-wallet summary, earnings (20),
// days (30), withdrawals (20, destination masked)}.
export function useStaffRiderWallet(riderId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['staff-rider-wallet', riderId],
    queryFn: () => apiFetch(`/api/delivery/riders/${riderId}/wallet/`),
    enabled: enabled && riderId != null,
    refetchOnWindowFocus: true,
    retry: retryUnlessWalletOff,
  })
}

// GET /api/delivery/rider-commission/?day= -> {day, results[], totals}. An empty
// day is left out: the server answers for yesterday (Accra).
export function useStaffRiderCommission(day = '', { enabled = true } = {}) {
  return useQuery({
    queryKey: ['staff-rider-commission', day || 'default'],
    queryFn: () => apiFetch(`/api/delivery/rider-commission/${day ? `?day=${encodeURIComponent(day)}` : ''}`),
    enabled,
    refetchOnWindowFocus: true,
    retry: retryUnlessWalletOff,
  })
}
