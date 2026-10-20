import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET {basePath}/ — the signed-in person's wallet summary, NOT paginated: the
// body is returned as sent, `{kind:"customer", balance}` or
// `{kind:"vendor", pending, available}` (7C adds `held_topup_pesewas` and
// `topup_free_at`). Amounts are the server's decimal strings.
// While the ledger is off the server answers 409 {code:"ledger_off"}; it
// surfaces as `error.body.code`, and that code is never retried so the "off"
// state does not spin.
export function retryUnlessLedgerOff(failureCount, error) {
  return error?.body?.code !== 'ledger_off' && failureCount < 2
}

export function useWallet({ basePath = '/api/wallet', enabled = true } = {}) {
  return useQuery({
    queryKey: ['wallet', basePath],
    queryFn: () => apiFetch(`${basePath}/`),
    enabled,
    retry: retryUnlessLedgerOff,
  })
}

// GET /api/wallet/vendor/ — a business owner's money overview, NOT paginated:
// `pending, available, withdrawable, negative, awaiting_call, fee_cap`.
export function useVendorWalletOverview({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['wallet', 'vendor'],
    queryFn: () => apiFetch('/api/wallet/vendor/'),
    enabled,
    retry: retryUnlessLedgerOff,
  })
}
