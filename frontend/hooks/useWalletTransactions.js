import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'
import { retryUnlessLedgerOff } from './useWallet.js'

// GET /api/wallet/transactions/?page= — PAGINATED ({count, next, previous,
// results}): callers read `data?.results` and follow `next`. Row fields:
// id, at, account, kind, label, direction, amount, order, booking_sale,
// reference.
export function useWalletTransactions(page = 1, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['wallet', 'transactions', page],
    queryFn: () => apiFetch(`/api/wallet/transactions/?page=${page}`),
    enabled,
    retry: retryUnlessLedgerOff,
  })
}
