import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'
import { retryUnlessLedgerOff } from './useWallet.js'

// GET /api/wallet/staff/reconciliation/ — NOT paginated: {results: [...]}, the last 30 daily runs
// newest first: {day, provider, status, status_label, ledger_in, statement_in, ledger_out,
// statement_out, in_transit, in_transit_note, unavailable_checks, statement_source, differences,
// fraud_case_id, ran_at}. Needs wallets.view; 409 {code:"ledger_off"} while the ledger is off.
export function useWalletReconciliation({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['wallet-reconciliation'],
    queryFn: () => apiFetch('/api/wallet/staff/reconciliation/'),
    enabled,
    retry: retryUnlessLedgerOff,
  })
}
