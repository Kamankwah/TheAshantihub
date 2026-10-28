import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiPost } from '../../apiClient.js'
import { useWithdrawals } from '../../hooks/useWithdrawals.js'
import { usePagedRows } from './usePagedRows.js'
import { walletMessage } from './walletErrors.js'
import { formatGhs, formatWhen } from './walletMoney.js'
import { walletStyles } from './walletStyles.js'

const FINAL = ['succeeded', 'failed', 'cancelled']

// The holder's withdrawals, newest first. Cancel is offered on every row that
// is not final and the server decides: its reply (the updated row, or e.g.
// "Only a withdrawal not sent yet can be cancelled.") is what is shown.
export default function WithdrawalHistory({ tone = 'light', basePath = '/api/wallet' }) {
  const s = walletStyles(tone)
  const queryClient = useQueryClient()
  const { query, loaded, rows, hasMore, loadMore, loadError } = usePagedRows((page) => useWithdrawals(page, { basePath }))
  const [updated, setUpdated] = useState({})
  const [notes, setNotes] = useState({})
  const [cancelling, setCancelling] = useState(null)

  if (query.error && !loaded.length) {
    const m = walletMessage(query.error)
    return <div style={s.card}><div style={m.kind === 'off' ? s.note : s.error}>{m.text}</div></div>
  }
  if (!loaded.length) return <div style={s.card}><div style={s.note}>Loading your withdrawals…</div></div>
  if (!rows.length) return <div style={s.card}><div style={s.note}>No withdrawals yet.</div></div>

  async function cancel(id) {
    setCancelling(id)
    setNotes((n) => ({ ...n, [id]: null }))
    try {
      const res = await apiPost(`${basePath}/withdrawals/${id}/cancel/`, {})
      setUpdated((u) => ({ ...u, [id]: res }))
      queryClient.invalidateQueries({ queryKey: ['wallet'] })
    } catch (err) {
      setNotes((n) => ({ ...n, [id]: walletMessage(err).text }))
    } finally {
      setCancelling(null)
    }
  }

  return (
    <div style={s.card}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((original) => {
          const r = updated[original.id] || original
          const when = formatWhen(r.created_at)
          const d = r.destination
          return (
            <li key={r.id} style={{ padding: '12px 0', borderTop: s.card.border }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={s.value}>{r.status_label}</div>
                  {when && <div style={s.note}>{when}</div>}
                  {d && <div style={s.note}>To {d.institution} {d.account_number_masked}</div>}
                </div>
                <div style={{ ...s.amount, whiteSpace: 'nowrap' }}>{formatGhs(r.amount)}</div>
              </div>
              <div style={{ ...s.note, marginTop: 4 }}>
                Charge <span style={s.amount}>{formatGhs(r.charge)}</span> · You receive <span style={s.amount}>{formatGhs(r.you_receive)}</span>
              </div>
              {r.failure_reason && <div style={{ ...s.note, marginTop: 4 }}>{r.failure_reason}</div>}
              {notes[original.id] && <div role="alert" style={{ ...s.error, marginTop: 8 }}>{notes[original.id]}</div>}
              {!FINAL.includes(r.status) && (
                <button
                  type="button" style={{ ...s.ghost, marginTop: 8 }} disabled={cancelling === original.id}
                  onClick={() => cancel(original.id)}
                >
                  Cancel
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {loadError && <div style={{ ...s.error, marginTop: 12 }}>{loadError.text}</div>}
      {hasMore && (
        <button type="button" style={{ ...s.ghost, marginTop: 12 }} disabled={query.isFetching} onClick={loadMore}>Load more</button>
      )}
    </div>
  )
}
