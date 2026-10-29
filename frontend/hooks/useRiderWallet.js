import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// The third-party rider's own wallet. Not paginated: useRiderWallet (the summary,
// returned as sent) and useRiderWalletDays (`{results}`, the last 30 days).
// Paginated (DRF envelope {count, next, previous, results}): useRiderWalletEarnings.
// The statement, destinations and withdrawals use 3F's holder-agnostic hooks with
// this base path.
export const RIDER_WALLET_BASE = '/api/delivery/rider/wallet'

// ledger_off: the wallets are not switched on. wallet_disabled: an AshantiHub-employed
// rider (paid through payroll). Neither changes by asking again, so neither is retried.
function retryUnlessWalletOff(failureCount, error) {
  const code = error?.body?.code
  return code !== 'ledger_off' && code !== 'wallet_disabled' && failureCount < 2
}

export function useRiderWallet({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['rider-wallet'],
    queryFn: () => apiFetch(`${RIDER_WALLET_BASE}/`),
    enabled,
    retry: retryUnlessWalletOff,
  })
}

// An empty `day` is left out of the request.
export function useRiderWalletEarnings({ day = '', page = 1, enabled = true } = {}) {
  return useQuery({
    queryKey: ['rider-wallet', 'earnings', day, page],
    queryFn: () => {
      const params = new URLSearchParams()
      if (day) params.set('day', day)
      params.set('page', String(page))
      return apiFetch(`${RIDER_WALLET_BASE}/earnings/?${params.toString()}`)
    },
    enabled,
    retry: retryUnlessWalletOff,
  })
}

export function useRiderWalletDays({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['rider-wallet', 'days'],
    queryFn: () => apiFetch(`${RIDER_WALLET_BASE}/days/`),
    enabled,
    retry: retryUnlessWalletOff,
  })
}
