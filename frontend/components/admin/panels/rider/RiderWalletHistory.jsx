import { useState } from 'react'
import { RIDER_WALLET_BASE, useRiderWalletDays, useRiderWalletEarnings } from '../../../../hooks/useRiderWallet.js'
import TransactionsList from '../../../wallet/TransactionsList.jsx'
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

// The rider's paid deliveries, newest first, optionally for one day. The query
// follows the server's `next` link one page at a time and keeps what it loaded.
export function RiderDeliveries() {
  const s = walletStyles(TONE)
  const [day, setDay] = useState('')
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState({ day: '', rows: [] })
  const query = useRiderWalletEarnings({ day, page })
  const data = query.data

  // Rows accumulate per (day, page); changing the day starts over.
  const kept = pages.day === day ? pages.rows : []
  const byPage = { ...Object.fromEntries(kept.map(([p, d]) => [p, d])) }
  if (data) byPage[page] = data
  const loaded = Object.keys(byPage).map(Number).sort((a, b) => a - b).map((p) => byPage[p])
  const rows = loaded.flatMap((d) => d.results || [])
  const hasMore = loaded.length > 0 && Boolean(loaded[loaded.length - 1].next)

  const changeDay = (v) => { setDay(v); setPage(1); setPages({ day: v, rows: [] }) }
  const loadMore = () => {
    setPages({ day, rows: Object.entries(byPage) })
    setPage(page + 1)
  }

  const filter = (
    <div style={{ marginBottom: 12 }}>
      <label style={s.label} htmlFor="rider-day-filter">Show one day</label>
      <input id="rider-day-filter" type="date" style={{ ...s.field, maxWidth: 220 }} value={day} onChange={(e) => changeDay(e.target.value)} />
    </div>
  )

  if (!rows.length) {
    return (
      <div>
        {filter}
        {query.isLoading || query.error
          ? <Notice s={s} query={query}>Loading your deliveries…</Notice>
          : <div style={s.card}><div style={s.note}>No delivery has been paid to your wallet yet.</div></div>}
      </div>
    )
  }

  return (
    <div>
      {filter}
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
        {query.error && <div style={{ ...s.error, marginTop: 12 }}>{walletMessage(query.error).text}</div>}
        {hasMore && (
          <button type="button" style={{ ...s.ghost, marginTop: 12 }} disabled={query.isFetching} onClick={loadMore}>Load more</button>
        )}
      </div>
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
