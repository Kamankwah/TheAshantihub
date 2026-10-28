import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiPost } from '../../apiClient.js'
import { useWallet } from '../../hooks/useWallet.js'
import { useWalletProcessing } from '../../hooks/useWalletProcessing.js'
import ProcessingLine from './ProcessingLine.jsx'
import { walletMessage } from './walletErrors.js'
import { formatGhs, isPlausibleAmount } from './walletMoney.js'
import { walletStyles } from './walletStyles.js'

// Add money to the wallet by mobile money. The processing figures come from
// the server (ProcessingLine); the button posts only a plausible amount.
export default function TopUpForm({ tone = 'light', onDone }) {
  const s = walletStyles(tone)
  const queryClient = useQueryClient()
  const wallet = useWallet()
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const plausible = isPlausibleAmount(amount)
  const processing = useWalletProcessing(amount)
  const quote = processing.data
  const off = wallet.error ? walletMessage(wallet.error).kind === 'off' : false

  if (off) return <div style={s.card}><div style={s.note}>{walletMessage(wallet.error).text}</div></div>

  async function submit(e) {
    e.preventDefault()
    if (busy || !plausible) return
    setBusy(true)
    setError(null)
    try {
      const res = await apiPost('/api/wallet/top-up/', { amount })
      if (res?.mode === 'redirect' && res.checkout_url) {
        window.location.href = res.checkout_url
        return
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['wallet'] }),
        queryClient.invalidateQueries({ queryKey: ['wallet', 'transactions'] }),
      ])
      setAmount('')
      if (onDone) onDone(res)
    } catch (err) {
      setError(walletMessage(err).text)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={s.card} noValidate>
      <label style={s.label} htmlFor="wallet-topup-amount">Amount to add (GH₵)</label>
      <input
        id="wallet-topup-amount" style={s.field} inputMode="decimal" autoComplete="off"
        value={amount} onChange={(e) => setAmount(e.target.value.trim())}
      />
      {plausible && <ProcessingLine amount={amount} tone={tone} />}
      {plausible && quote && quote.payment_processing !== '0.00' && (
        <div style={{ ...s.note, marginTop: 6 }}>
          You pay {formatGhs(quote.you_pay)} (includes {formatGhs(quote.payment_processing)} payment processing); {formatGhs(quote.amount)} reaches your wallet.
        </div>
      )}
      {error && <div role="alert" style={{ ...s.error, marginTop: 12 }}>{error}</div>}
      <div style={{ marginTop: 16 }}>
        <button type="submit" style={{ ...s.button, opacity: busy || !plausible ? 0.6 : 1 }} disabled={busy || !plausible}>
          {busy ? 'Working…' : 'Top up'}
        </button>
      </div>
    </form>
  )
}
