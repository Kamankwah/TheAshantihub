import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'
import { retryUnlessLedgerOff } from './useWallet.js'

// GET {basePath}/withdrawals/?page= — PAGINATED ({count, next, previous,
// results}): callers read `data?.results` and follow `next`.
export function useWithdrawals(page = 1, { basePath = '/api/wallet', enabled = true } = {}) {
  return useQuery({
    queryKey: ['wallet', 'withdrawals', basePath, page],
    queryFn: () => apiFetch(`${basePath}/withdrawals/?page=${page}`),
    enabled,
    retry: retryUnlessLedgerOff,
  })
}
