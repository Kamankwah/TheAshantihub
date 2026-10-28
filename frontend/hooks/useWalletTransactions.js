import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'
import { retryUnlessLedgerOff } from './useWallet.js'

// GET /api/wallet/transactions/?page= — PAGINATED ({count, next, previous,
// results}): callers read `data?.results` and follow `next`. Row fields:
// id, at, account, kind, label, direction, amount, order, booking_sale,
// reference.
// `path` defaults to the customer/vendor journal; a rider passes its own statement path.
export function useWalletTransactions(page = 1, { enabled = true, path = '/api/wallet/transactions/' } = {}) {
  return useQuery({
    queryKey: ['wallet', 'transactions', path, page],
    queryFn: () => apiFetch(`${path}?page=${page}`),
    enabled,
    retry: retryUnlessLedgerOff,
  })
}
