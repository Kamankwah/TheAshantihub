import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiPost } from '../../apiClient.js'
import { useWalletDestinations } from '../../hooks/useWalletDestinations.js'
import { refusalCode, walletMessage } from './walletErrors.js'
import { formatGhs, formatWhen, isPlausibleAmount, newRequestId } from './walletMoney.js'
import { walletStyles } from './walletStyles.js'

// Withdraw to one of the holder's usable payout numbers. Holder-agnostic:
// `basePath` is '/api/wallet' (customers) or the vendor / rider base path.
//
// Idempotency: one request_id is made when the form mounts and sent by every
// submit of the same destination and amount (a double click, a retry after a
// network error, the step-up retry inside apiClient). It is replaced only when
// the destination or amount actually submitted differs from the last one sent,
// and after a success. The charge is shown
// only once the server has answered; nothing is estimated here.
export default function WithdrawForm({ tone = 'light', basePath = '/api/wallet', onDone }) {
  const s = walletStyles(tone)
  const queryClient = useQueryClient()
  const destinations = useWalletDestinations({ basePath })
  // {key, id}: the id belongs to what was last submitted. key is null until the first submit adopts the id made at mount.
  const sent = useRef(null)
  if (sent.current === null) sent.current = { key: null, id: newRequestId() }
  const inFlight = useRef(false)
  const [amount, setAmount] = useState('')
  // undefined until the first data arrives; then the id the user holds. It is never re-picked silently.
  const [chosen, setChosen] = useState(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  if (destinations.error && !destinations.data) {
    const m = walletMessage(destinations.error)
    return <div style={s.card}><div style={m.kind === 'off' ? s.note : s.error}>{m.text}</div></div>
  }
  if (!destinations.data) return <div style={s.card}><div style={s.note}>Loading…</div></div>

  const all = destinations.data.results || []
  const usable = all.filter((d) => d.usable)
  if (!usable.length) {
    const waiting = all.some((d) => !d.removed)
    return (
      <div style={s.card}>
        <div style={s.note}>{waiting ? 'Your new number is still in its waiting period' : 'Add a payout number first'}</div>
      </div>
    )
  }
  if (chosen === undefined) setChosen(usable[0].id)
  const destination = usable.find((d) => d.id === chosen)
  const gone = chosen != null && chosen !== undefined && !destination
  const plausible = isPlausibleAmount(amount) && Boolean(destination)

  async function submit(e) {
    e.preventDefault()
    if (inFlight.current || !plausible || !destination) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      // Decided at submit time from what is being sent, so editing and reverting the amount (or "100" vs "100.00") reuses the id.
      const key = `${destination.id}|${formatGhs(amount)}`
      if (sent.current.key !== null && sent.current.key !== key) sent.current = { key, id: newRequestId() }
      else sent.current.key = key
      const res = await apiPost(`${basePath}/withdrawals/`, { destination: destination.id, amount, request_id: sent.current.id })
      sent.current = { key: null, id: newRequestId() }
      setResult(res)
      setAmount('')
      await queryClient.invalidateQueries({ queryKey: ['wallet'] })
      if (onDone) onDone(res)
    } catch (err) {
      const m = walletMessage(err)
      const freeAt = refusalCode(err) === 'topup_held' ? formatWhen(err.body?.free_at) : null
      setError(freeAt ? `${m.text} It can be withdrawn from ${freeAt}.` : m.text)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const row = (label, value, isMoney = true) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0' }}>
      <span style={s.note}>{label}</span><span style={isMoney ? s.amount : s.value}>{value}</span>
    </div>
  )

  return (
    <form onSubmit={submit} style={s.card} noValidate>
      <label style={s.label} htmlFor="wallet-withdraw-destination">Pay out to</label>
      <select
        id="wallet-withdraw-destination" style={s.field} value={destination ? destination.id : ''}
        onChange={(e) => { setChosen(Number(e.target.value)); setResult(null) }}
      >
        {!destination && <option value="" disabled>Choose a number</option>}
        {usable.map((d) => (
          <option key={d.id} value={d.id}>{d.institution} {d.account_number_masked} ({d.account_name})</option>
        ))}
      </select>
      {gone && <div role="alert" style={{ ...s.error, marginTop: 8 }}>The number you chose can't receive money now. Choose another.</div>}
      <label style={{ ...s.label, marginTop: 12 }} htmlFor="wallet-withdraw-amount">Amount to withdraw (GH₵)</label>
      <input
        id="wallet-withdraw-amount" style={s.field} inputMode="decimal" autoComplete="off" value={amount}
        onChange={(e) => { setAmount(e.target.value.trim()); setResult(null) }}
      />
      {error && <div role="alert" style={{ ...s.error, marginTop: 12 }}>{error}</div>}
      {result && (
        <div role="status" style={{ marginTop: 12 }}>
          {result.amount != null && <div style={s.value}>{formatGhs(result.amount)} withdrawal</div>}
          {row('Charge', formatGhs(result.charge))}
          {row('You receive', formatGhs(result.you_receive))}
          {row('Status', result.status_label, false)}
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <button type="submit" style={{ ...s.button, opacity: busy || !plausible ? 0.6 : 1 }} disabled={busy || !plausible}>
          {busy ? 'Working…' : 'Withdraw'}
        </button>
      </div>
    </form>
  )
}
