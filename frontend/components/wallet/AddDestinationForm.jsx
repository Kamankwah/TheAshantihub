import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiPost } from '../../apiClient.js'
import { refusalCode, walletMessage } from './walletErrors.js'
import { formatWhen } from './walletMoney.js'
import { walletStyles } from './walletStyles.js'

// The mobile money networks the server accepts; a bank name is free text.
const NETWORKS = ['MTN', 'Telecel', 'AirtelTigo']

// Add a payout destination. Step-up is apiClient's: the first 403
// step_up_required opens the code prompt and the request is retried with the
// token, so this form posts the same body once from its point of view and
// never reads or stores a token. The server's refusal text is the only
// validation. `canCopyFromProfile` (vendors) offers the registered details.
export default function AddDestinationForm({ tone = 'light', basePath = '/api/wallet', canCopyFromProfile = false, onDone, refusalAction }) {
  const s = walletStyles(tone)
  const queryClient = useQueryClient()
  const [rail, setRail] = useState('momo')
  const [institution, setInstitution] = useState('MTN')
  const [number, setNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [errorCode, setErrorCode] = useState(null)
  const [added, setAdded] = useState(null)

  function chooseRail(next) {
    setRail(next)
    setInstitution(next === 'momo' ? NETWORKS[0] : '')
  }

  async function send(body) {
    if (busy) return
    setBusy(true)
    setError(null)
    setErrorCode(null)
    setAdded(null)
    try {
      const res = await apiPost(`${basePath}/destinations/`, body)
      setNumber('')
      const from = formatWhen(res?.usable_from)
      setAdded(from ? `Added. It can receive money from ${from}` : 'Added.')
      await queryClient.invalidateQueries({ queryKey: ['wallet', 'destinations', basePath] })
      if (onDone) onDone(res)
    } catch (err) {
      setErrorCode(refusalCode(err))
      setError(walletMessage(err).text)
    } finally {
      setBusy(false)
    }
  }

  function submit(e) {
    e.preventDefault()
    send({ rail, institution: institution.trim(), account_number: number.trim() })
  }

  return (
    <form onSubmit={submit} style={s.card} noValidate>
      <label style={s.label} htmlFor="wallet-dest-rail">Pay out to</label>
      <select id="wallet-dest-rail" style={s.field} value={rail} onChange={(e) => chooseRail(e.target.value)}>
        <option value="momo">Mobile money</option>
        <option value="bank">Bank account</option>
      </select>

      <label style={{ ...s.label, marginTop: 12 }} htmlFor="wallet-dest-institution">{rail === 'momo' ? 'Network' : 'Bank name'}</label>
      {rail === 'momo' ? (
        <select id="wallet-dest-institution" style={s.field} value={institution} onChange={(e) => setInstitution(e.target.value)}>
          {NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      ) : (
        <input id="wallet-dest-institution" style={s.field} autoComplete="off" value={institution} onChange={(e) => setInstitution(e.target.value)} />
      )}

      <label style={{ ...s.label, marginTop: 12 }} htmlFor="wallet-dest-number">{rail === 'momo' ? 'Mobile money number' : 'Account number'}</label>
      <input
        id="wallet-dest-number" style={{ ...s.field, fontVariantNumeric: 'tabular-nums' }} inputMode="numeric" autoComplete="off"
        value={number} onChange={(e) => setNumber(e.target.value)}
      />

      {error && <div role="alert" style={{ ...s.error, marginTop: 12 }}>{error}</div>}
      {error && refusalAction && errorCode ? refusalAction(errorCode) : null}
      {added && <div role="status" style={{ ...s.note, marginTop: 12 }}>{added}</div>}

      <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button type="submit" style={{ ...s.button, opacity: busy ? 0.6 : 1 }} disabled={busy}>
          {busy ? 'Working…' : 'Add destination'}
        </button>
        {canCopyFromProfile && (
          <button type="button" style={s.ghost} disabled={busy} onClick={() => send({ from_profile: true })}>
            Use my registered payout details
          </button>
        )}
      </div>
    </form>
  )
}
