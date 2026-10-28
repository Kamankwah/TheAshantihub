import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'
import { retryUnlessLedgerOff } from './useWallet.js'

// GET /api/wallet/staff/withdrawals/?status=open|succeeded|failed|cancelled|all&page= — PAGINATED
// ({count, next, previous, results}): read `data?.results` and follow `next`. Newest first; `open`
// (held or sent, not settled) is the server's default. Rows are the customer's withdrawal row
// (id, reference, amount, charge, you_receive, status, status_label, destination with a masked
// number, created_at, settled_at, failure_reason) plus holder_type, holder_id, holder_name, provider,
// provider_reference, submitted_at and `stuck`. `holderType` (customer|business_owner|staff) adds &holder_type=. Needs wallets.view; 409 {code:"ledger_off"} while off.
export function useStaffWithdrawals({ status = 'open', page = 1, holderType = '', enabled = true } = {}) {
  return useQuery({
    queryKey: holderType ? ['staff-withdrawals', status, page, holderType] : ['staff-withdrawals', status, page],
    queryFn: () => apiFetch(`/api/wallet/staff/withdrawals/?status=${status}&page=${page}${holderType ? `&holder_type=${holderType}` : ''}`),
    enabled,
    retry: retryUnlessLedgerOff,
  })
}
