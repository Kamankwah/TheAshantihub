import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiPost } from '../../apiClient.js'
import { useWalletDestinations } from '../../hooks/useWalletDestinations.js'
import { walletMessage } from './walletErrors.js'
import { formatWhen } from './walletMoney.js'
import { walletStyles } from './walletStyles.js'

const RAILS = { momo: 'Mobile money', bank: 'Bank' }

// The holder's saved payout destinations, numbers masked as sent. Holder-
// agnostic: `basePath` is '/api/wallet' (customers) or the vendor base path.
// There is deliberately no Edit: a number is removed and a new one added,
// which keeps the cooling period honest. Remove is step-up gated (apiClient
// prompts and retries; this component never sees the token).
export default function DestinationsList({ tone = 'light', basePath = '/api/wallet', onChanged }) {
  const s = walletStyles(tone)
  const queryClient = useQueryClient()
  const { data, error: loadError, isLoading, refetch } = useWalletDestinations({ basePath })
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)

  if (loadError) {
    const m = walletMessage(loadError)
    return (
      <div style={s.card}>
        <div style={m.kind === 'off' ? s.note : s.error} role={m.kind === 'off' ? undefined : 'alert'}>{m.text}</div>
        {m.kind !== 'off' && <div style={{ marginTop: 12 }}><button type="button" style={s.ghost} onClick={() => refetch()}>Try again</button></div>}
      </div>
    )
  }
  if (isLoading) return <div style={s.card}><div style={s.note}>Loading…</div></div>

  const rows = (data?.results || []).filter((d) => !d.removed)

  async function remove(d) {
    if (busyId) return
    if (!window.confirm('Remove this payout destination? You can add it again later, but a new one waits before it can receive money.')) return
    setBusyId(d.id)
    setError(null)
    try {
      await apiPost(`${basePath}/destinations/${d.id}/remove/`, {})
      await queryClient.invalidateQueries({ queryKey: ['wallet', 'destinations', basePath] })
      if (onChanged) onChanged()
    } catch (err) {
      setError(walletMessage(err).text)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      {data?.cooling_hours != null && (
        <div style={{ ...s.note, marginBottom: 12 }}>A new number can receive money after {data.cooling_hours} hours.</div>
      )}
      {error && <div role="alert" style={{ ...s.error, marginBottom: 12 }}>{error}</div>}
      {rows.length === 0 && <div style={s.card}><div style={s.note}>No payout destinations yet.</div></div>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
        {rows.map((d) => {
          const from = !d.usable ? formatWhen(d.usable_from) : null
          return (
            <li key={d.id} style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ ...s.value, fontWeight: 700 }}>{RAILS[d.rail] || d.rail} · {d.institution}</div>
                  <div style={s.value}>{d.account_name}</div>
                  <div style={{ ...s.value, fontVariantNumeric: 'tabular-nums' }}>{d.account_number_masked}</div>
                  {d.name_check && (
                    <div style={{ ...s.note, marginTop: 4 }}>{d.name_check === 'simulated' ? 'Name check simulated' : 'Name checked'}</div>
                  )}
                  {!d.usable && from && <div style={{ ...s.note, marginTop: 4 }}>Can receive money from {from}</div>}
                </div>
                <div>
                  <button type="button" style={s.ghost} disabled={busyId === d.id} onClick={() => remove(d)}>
                    {busyId === d.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
