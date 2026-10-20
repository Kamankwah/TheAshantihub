import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'
import { isPlausibleAmount } from '../components/wallet/walletMoney.js'
import { retryUnlessLedgerOff } from './useWallet.js'

// GET /api/wallet/processing/?amount= — NOT paginated: what a top-up of
// `amount` costs, `{amount, payment_processing, you_pay, provider}`. Asked
// only once the typed amount looks like money (isPlausibleAmount saves a
// request; the server's answer still wins). A refusal is a 400 {amount} and
// surfaces as `error.body.amount`.
export function useWalletProcessing(amount) {
  return useQuery({
    queryKey: ['wallet', 'processing', amount],
    queryFn: () => apiFetch(`/api/wallet/processing/?amount=${encodeURIComponent(amount)}`),
    enabled: typeof amount === 'string' && amount !== '' && isPlausibleAmount(amount),
    retry: (count, error) => error?.status !== 400 && retryUnlessLedgerOff(count, error),
  })
}
