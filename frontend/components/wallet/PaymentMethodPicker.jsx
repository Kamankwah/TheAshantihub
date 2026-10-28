import { useWallet } from '../../hooks/useWallet.js'
import ProcessingLine from './ProcessingLine.jsx'
import { formatGhs, ghsToPesewas } from './walletMoney.js'
import { walletStyles } from './walletStyles.js'

// How to pay: "Mobile money" or "AshantiHub wallet" (value "momo" | "wallet").
// Owns its data: the wallet balance comes from useWallet. While the ledger is
// off, loading, or on any error there is no wallet row at all, so checkout
// looks exactly as it did before wallets. The wallet option is disabled when
// the balance is below `amount` (two server strings compared as whole pesewas,
// display only: the server still decides and answers insufficient_funds).
// The server's processing line sits under mobile money; none for the wallet.
export default function PaymentMethodPicker({ value = 'momo', onChange, amount, tone = 'light' }) {
  const s = walletStyles(tone)
  const { data: wallet } = useWallet()
  const hasWallet = !!wallet && wallet.balance !== undefined
  const balance = hasWallet ? ghsToPesewas(wallet.balance) : null
  const needed = ghsToPesewas(amount)
  const short = balance !== null && needed !== null && balance < needed
  const choose = (method) => () => onChange && onChange(method)
  const row = { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', minHeight: 44, cursor: 'pointer' }

  return (
    <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
      <legend style={s.label}>Pay with</legend>
      <label style={row}>
        <input type="radio" name="payment-method" checked={value === 'momo'} onChange={choose('momo')} />
        <span style={s.value}>Mobile money</span>
      </label>
      {hasWallet && (
        <label style={{ ...row, cursor: short ? 'not-allowed' : 'pointer' }}>
          <input type="radio" name="payment-method" checked={value === 'wallet'} disabled={short} onChange={choose('wallet')} />
          <span style={s.value}>
            AshantiHub wallet
            <span style={{ ...s.note, display: 'block' }}>
              Balance <span style={s.amount}>{formatGhs(wallet.balance)}</span>
            </span>
            {short && <span style={{ ...s.note, display: 'block' }}>Your balance is less than {formatGhs(amount)}.</span>}
          </span>
        </label>
      )}
      {value !== 'wallet' && <ProcessingLine amount={amount} tone={tone} method="momo" />}
    </fieldset>
  )
}
