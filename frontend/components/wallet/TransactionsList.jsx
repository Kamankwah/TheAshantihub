import { useState } from 'react'
import { useWalletTransactions } from '../../hooks/useWalletTransactions.js'
import { usePagedRows } from './usePagedRows.js'
import RefundNotice from './RefundNotice.jsx'
import { walletMessage } from './walletErrors.js'
import { formatGhs, formatWhen } from './walletMoney.js'
import { walletStyles } from './walletStyles.js'

// Filter groups by the server's journal kinds (backend/wallets/services.py
// LABELS). A kind in no group shows only under All.
const GROUPS = [
  { id: 'topups', label: 'Top-ups', kinds: ['wallet_top_up'] },
  { id: 'purchases', label: 'Purchases', kinds: ['order_payment', 'booking_payment'] },
  { id: 'refunds', label: 'Refunds', kinds: ['order_refund', 'booking_refund'] },
  { id: 'withdrawals', label: 'Withdrawals', kinds: ['withdrawal_hold', 'withdrawal_reversed'] },
  { id: 'releases', label: 'Releases', kinds: ['order_release', 'booking_release'] },
  { id: 'promos', label: 'Free-delivery promos', kinds: ['order_waiver_charge', 'order_waiver_return'] },
]
// A vendor's money sits in two accounts; a release debits Pending and credits Available.
const ACCOUNTS = { pending: 'Pending', available: 'Available' }
const REFUND_KINDS = ['order_refund', 'booking_refund']

const hidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' }

// A holder's statement. Holder-agnostic: the customer pages and the vendor
// Money tab both compose it. An order link renders only when the caller
// passes `orderHref(orderId)`. Filtering is client-side on loaded pages.
// `path` reads another holder's journal; `filters={false}` hides the chips;
// `accountLabels` is merged over the built-in account words. `limit` shows only
// the newest N rows (no chips, no Load more): a "recent activity" glance.
// `empty` is an extra node under the empty-state line (e.g. a way onward).
export default function TransactionsList({ tone = 'light', orderHref, path, filters = true, accountLabels, limit, empty }) {
  const s = walletStyles(tone)
  const [group, setGroup] = useState('all')
  const { query, loaded, rows, hasMore, loadMore, loadError } = usePagedRows((p) => useWalletTransactions(p, path ? { path } : undefined))
  const accounts = accountLabels ? { ...ACCOUNTS, ...accountLabels } : ACCOUNTS

  if (query.error && !loaded.length) {
    const m = walletMessage(query.error)
    return <div style={s.card}><div style={m.kind === 'off' ? s.note : s.error}>{m.text}</div></div>
  }
  if (!loaded.length) return <div style={s.card}><div style={s.note}>Loading your transactions…</div></div>
  if (!rows.length) return <div style={s.card}><div style={s.note}>You don't have any transactions yet.</div>{empty}</div>

  const chips = !filters || limit ? [] : GROUPS.filter((g) => rows.some((r) => g.kinds.includes(r.kind)))
  const active = chips.find((g) => g.id === group)
  const filtered = active ? rows.filter((r) => active.kinds.includes(r.kind)) : rows
  const shown = limit ? filtered.slice(0, limit) : filtered
  const chipStyle = (on) => ({ ...s.ghost, padding: '6px 12px', minHeight: 36, fontSize: 13, fontWeight: on ? 700 : 500 })

  return (
    <div style={s.card}>
      {chips.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[{ id: 'all', label: 'All' }, ...chips].map((g) => (
              <button key={g.id} type="button" aria-pressed={(active ? active.id : 'all') === g.id} onClick={() => setGroup(g.id)} style={chipStyle((active ? active.id : 'all') === g.id)}>{g.label}</button>
            ))}
          </div>
          {hasMore && <div style={{ ...s.note, marginTop: 6 }}>Shows what is loaded</div>}
        </div>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {shown.map((r) => {
          const incoming = r.direction === 'in'
          const when = formatWhen(r.at)
          return (
            <li key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderTop: s.card.border }}>
              <div style={{ minWidth: 0 }}>
                <div style={s.value}>{r.label}{accounts[r.account] && <span style={{ ...s.note, marginLeft: 8 }}>{accounts[r.account]}</span>}</div>
                {when && <div style={s.note}>{when}</div>}
                {REFUND_KINDS.includes(r.kind) && incoming && <RefundNotice line={r} tone={tone} />}
                {r.order && typeof orderHref === 'function' && (
                  <a href={orderHref(r.order)} style={{ ...s.note, textDecoration: 'underline' }}>Order #{r.order}</a>
                )}
              </div>
              <div style={{ ...s.amount, whiteSpace: 'nowrap' }}>
                <span aria-hidden="true">{incoming ? '↓ ' : '↑ '}</span>
                <span style={hidden}>{incoming ? 'in' : 'out'}</span>
                {incoming ? '+' : '−'}{formatGhs(r.amount)}
              </div>
            </li>
          )
        })}
      </ul>
      {loadError && <div style={{ ...s.error, marginTop: 12 }}>{loadError.text}</div>}
      {hasMore && !limit && (
        <button type="button" style={{ ...s.ghost, marginTop: 12 }} disabled={query.isFetching} onClick={loadMore}>Load more</button>
      )}
    </div>
  )
}
