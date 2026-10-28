import { useWalletProcessing } from '../../hooks/useWalletProcessing.js'
import { formatGhs } from './walletMoney.js'
import { walletStyles } from './walletStyles.js'

// What the server says paying `amount` by mobile money costs. Renders nothing
// for a wallet payment, while the ledger is off, while loading, or on any
// error: a total with no line is honest, a guessed line is not.
export default function ProcessingLine({ amount, tone = 'light', method = 'momo' }) {
  const s = walletStyles(tone)
  const { data } = useWalletProcessing(method === 'wallet' ? '' : amount)
  if (method === 'wallet' || !data || data.payment_processing === undefined) return null
  const free = data.payment_processing === '0.00'
  return (
    <div style={{ ...s.value, marginTop: 8 }} data-testid="processing-line">
      {free ? (
        <div>No payment processing charge</div>
      ) : (
        <div>Payment processing <span style={s.amount}>{formatGhs(data.payment_processing)}</span></div>
      )}
      <div>You pay <span style={s.amount}>{formatGhs(data.you_pay)}</span></div>
    </div>
  )
}
