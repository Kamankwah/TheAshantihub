import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'
import { retryUnlessLedgerOff } from './useWallet.js'

// GET /api/ledger/pickup/?q=&page= — PAGINATED (DRF envelope {count, next, previous, results}, 20 a page):
// read `data?.results` and `count`. Each row: order_id, placed_at, collect_by, overdue, customer_name and
// items [{name, quantity, business}]. Deliberately no phone and no collection code. Needs pickup.confirm;
// 409 {code:"ledger_off"} while the ledger is off.
export function usePickupQueue({ q = '', page = 1 } = {}) {
  return useQuery({
    queryKey: ['ledger-pickup', q, page],
    queryFn: () => apiFetch(`/api/ledger/pickup/?q=${encodeURIComponent(q)}&page=${page}`),
    retry: retryUnlessLedgerOff,
  })
}
