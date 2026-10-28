import { useState } from 'react'
import { useWallet } from './useWallet.js'
import { useWalletProcessing } from './useWalletProcessing.js'
import { walletMessage } from '../components/wallet/walletErrors.js'

// How a booking (service, ticket, stay) is paid. Only a 409 ledger_off answer
// from the wallet means "off" (ruling R14); loading or any other error is
// "unknown" and blocks paying rather than guessing. While the ledger is on,
// mobile money waits for the server's processing quote. `body` is what to POST:
// {} while the ledger is off (unchanged requests), else {payment_method}.
export function useBookingPayment({ amount, inLedger = true, enabled = true } = {}) {
  const active = enabled && inLedger
  const wallet = useWallet({ enabled: active })
  const [method, setMethod] = useState('momo')

  let state = 'unknown'
  let walletProblem = null
  if (!active) state = 'off'
  else if (wallet.data) state = 'on'
  else if (wallet.error) {
    const m = walletMessage(wallet.error)
    if (m.kind === 'off') state = 'off'
    else walletProblem = m.text
  }

  const ledgerOn = state === 'on'
  const quote = useWalletProcessing(ledgerOn && method === 'momo' ? amount : '')
  const processing = quote.data?.payment_processing
  const quoteProblem = quote.error ? walletMessage(quote.error).text : null
  const ready = state === 'off' || (ledgerOn && (method === 'wallet' || processing !== undefined))

  return {
    state,
    ledgerOn,
    method,
    setMethod,
    processing,
    ready,
    problem: walletProblem ?? quoteProblem,
    body: ledgerOn ? { payment_method: method } : {},
  }
}
