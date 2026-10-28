import { useWallet } from '../../hooks/useWallet.js'
import AddDestinationForm from './AddDestinationForm.jsx'
import BalanceSummary from './BalanceSummary.jsx'
import DestinationsList from './DestinationsList.jsx'
import TransactionsList from './TransactionsList.jsx'
import WithdrawForm from './WithdrawForm.jsx'
import WithdrawalHistory from './WithdrawalHistory.jsx'
import { walletMessage } from './walletErrors.js'
import { walletStyles } from './walletStyles.js'

// The vendor's Money tab: balance, payout numbers, withdraw, history. The
// server decides the holder, so every section uses the default wallet path.
// While the ledger is off the whole tab is one honest line, decided from the
// same query BalanceSummary reads (shared cache), never hidden client-side.
// WithdrawForm is always rendered in the same place with no key: its
// idempotent request id lives in the form instance.
export default function VendorPayouts() {
  const s = walletStyles('dashboard')
  const wallet = useWallet()

  if (wallet.error && walletMessage(wallet.error).kind === 'off') {
    return <div style={s.card}><div style={s.note}>{walletMessage(wallet.error).text}</div></div>
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={s.note}>Withdrawals go only to a payout number whose account name matches your registered name.</div>
      <BalanceSummary tone="dashboard" />
      <DestinationsList tone="dashboard" />
      <AddDestinationForm tone="dashboard" canCopyFromProfile />
      <WithdrawForm tone="dashboard" />
      <WithdrawalHistory tone="dashboard" />
      <TransactionsList tone="dashboard" />
    </div>
  )
}
