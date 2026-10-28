import { useState } from 'react'
import { RIDER_WALLET_BASE, useRiderWalletDays, useRiderWalletEarnings } from '../../../../hooks/useRiderWallet.js'
import TransactionsList from '../../../wallet/TransactionsList.jsx'
import { usePagedRows } from '../../../wallet/usePagedRows.js'
import { percentFromBp } from '../../../wallet/riderMoney.js'
import { walletMessage } from '../../../wallet/walletErrors.js'
import { formatGhs, formatWhen } from '../../../wallet/walletMoney.js'
import { walletStyles } from '../../../wallet/walletStyles.js'

const TONE = 'dashboard'

function Notice({ s, query, children }) {
  if (query.error) {
    const m = walletMessage(query.error)
    return <div style={s.card}><div style={m.kind === 'off' ? s.note : s.error}>{m.text}</div></div>
  }
  return <div style={s.card}><div style={s.note}>{children}</div></div>
}

// The rider's paid deliveries, newest first, optionally for one day. Paging is
// 3F's usePagedRows (retries a failed page, restarts when page 1 changes, drops
// repeated ids); the list is keyed by day so a new day starts again from page 1.
export function RiderDeliveries() {
  const s = walletStyles(TONE)
  const [day, setDay] = useState('')
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <label style={s.label} htmlFor="rider-day-filter">Show one day</label>
        <input id="rider-day-filter" type="date" style={{ ...s.field, maxWidth: 220 }} value={day} onChange={(e) => setDay(e.target.value)} />
      </div>
      <DeliveriesList key={day} day={day} />
    </div>
  )
}

function DeliveriesList({ day }) {
  const s = walletStyles(TONE)
  const { query, loaded, rows, hasMore, loadMore, loadError } = usePagedRows((p) => useRiderWalletEarnings({ day, page: p }))

  if (query.error && !loaded.length) return <Notice s={s} query={query} />
  if (!loaded.length) return <Notice s={s} query={query}>Loading your deliveries…</Notice>
  if (!rows.length) return <div style={s.card}><div style={s.note}>No delivery has been paid to your wallet yet.</div></div>

  return (
    <div style={s.card}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((r, i) => {
          const when = formatWhen(r.delivered_at)
          return (
            <li key={r.id} style={{ padding: '12px 0', borderTop: i ? s.card.border : 'none' }}>
              <div style={{ ...s.value, fontWeight: 700 }}>{r.kind === 'redelivery' ? `Re-delivery of order #${r.order}` : `Order #${r.order}`}</div>
              {when && <div style={s.note}>{when}</div>}
              <div style={{ ...s.note, marginTop: 6 }}>Delivery fee <span style={s.amount}>{formatGhs(r.gross)}</span></div>
              <div style={s.note}>AshantiHub&apos;s commission ({percentFromBp(r.commission_bp)}) <span style={s.amount}>{formatGhs(r.commission)}</span></div>
              <div style={s.value}>You got <span style={s.amount}>{formatGhs(r.you_got)}</span></div>
              {r.status_label && <div style={s.note}>{r.status_label}</div>}
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

// The last 30 days of commission posted against the rider's deliveries.
export function RiderDays() {
  const s = walletStyles(TONE)
  const query = useRiderWalletDays()
  const rows = query.data?.results
  if (!rows) return <Notice s={s} query={query}>Loading your days…</Notice>
  if (!rows.length) {
    return <div style={s.card}><div style={s.note}>No day has been posted yet. AshantiHub&apos;s commission for a day is taken after midnight, Accra time.</div></div>
  }
  const givenBack = rows.some((r) => r.given_back !== '0.00' && r.given_back != null)
  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 13, fontWeight: 600, color: s.label.color }
  const num = { ...s.amount, padding: '10px', textAlign: 'right', whiteSpace: 'nowrap' }
  return (
    <div style={{ ...s.card, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th scope="col" style={th}>Day</th>
            <th scope="col" style={{ ...th, textAlign: 'right' }}>Deliveries</th>
            <th scope="col" style={{ ...th, textAlign: 'right' }}>Delivery fees</th>
            <th scope="col" style={{ ...th, textAlign: 'right' }}>Commission</th>
            {givenBack && <th scope="col" style={{ ...th, textAlign: 'right' }}>Given back</th>}
            <th scope="col" style={{ ...th, textAlign: 'right' }}>You got</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.day} style={{ borderTop: s.card.border }}>
              <td style={{ ...s.value, padding: '10px' }}>{r.day}</td>
              <td style={num}>{r.deliveries}</td>
              <td style={num}>{formatGhs(r.gross)}</td>
              <td style={num}>{formatGhs(r.commission)}</td>
              {givenBack && <td style={num}>{formatGhs(r.given_back)}</td>}
              <td style={num}>{formatGhs(r.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Every line of the rider's journal. The reserve account reads as commission held.
export function RiderStatement() {
  return (
    <TransactionsList
      tone={TONE}
      path={`${RIDER_WALLET_BASE}/statement/`}
      orderHref={null}
      filters={false}
      accountLabels={{ reserve: 'commission held' }}
    />
  )
}
