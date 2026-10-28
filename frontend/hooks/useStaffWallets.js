import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'
import { retryUnlessLedgerOff } from './useWallet.js'

// GET /api/wallet/staff/wallets/?kind=customer|vendor|rider&page= — PAGINATED
// ({count, next, previous, results}): read `data?.results` and follow `next`.
// Rows by kind: customer {holder_id, name, balance}; vendor {holder_id, name,
// pending, available}; rider {holder_id, rider_id, name, company_name,
// employment, balance, reserve}. Amounts are the server's decimal strings.
// Needs wallets.view; 409 {code:"ledger_off"} while the ledger is off.
export function useStaffWallets({ kind = 'customer', page = 1, enabled = true } = {}) {
  return useQuery({
    queryKey: ['staff-wallets', kind, page],
    queryFn: () => apiFetch(`/api/wallet/staff/wallets/?kind=${kind}&page=${page}`),
    enabled,
    retry: retryUnlessLedgerOff,
  })
}
