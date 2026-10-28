import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'
import { retryUnlessLedgerOff } from './useWallet.js'

// GET {basePath}/destinations/ — NOT a paginated envelope: `{results,
// cooling_hours}`. Numbers arrive masked and stay masked. `basePath` is
// '/api/wallet' (customers, the default) or the vendor base path.
export function useWalletDestinations({ basePath = '/api/wallet', enabled = true } = {}) {
  return useQuery({
    queryKey: ['wallet', 'destinations', basePath],
    queryFn: () => apiFetch(`${basePath}/destinations/`),
    enabled,
    retry: retryUnlessLedgerOff,
  })
}
