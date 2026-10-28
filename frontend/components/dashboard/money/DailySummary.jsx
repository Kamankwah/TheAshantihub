import { useState } from 'react'
import { useVendorDaily } from '../../../hooks/useVendorMoney.js'
import { signedGhs } from '../../wallet/walletMoney.js'
import { walletMessage } from '../../wallet/walletErrors.js'
import { walletStyles } from '../../wallet/walletStyles.js'
import { D } from '../theme.js'

// The daily summary: one row per Accra day, straight from the server. Nothing
// is summed here (totals come from the server); "Other" is always shown.
const s = walletStyles('dashboard')

const COLUMNS = [
  ['sold', 'Sold'], ['fees', 'Platform fees'], ['released', 'Released'], ['refunded', 'Refunded'],
  ['free_delivery_promo', 'Free-delivery promo'], ['withdrawn', 'Withdrawn'], ['other', 'Other'], ['net_change', 'Change'],
]
const cell = { padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: `1px solid ${D.divider}` }
const head = { ...cell, fontSize: 12, fontWeight: 700, color: D.textDim, textAlign: 'right' }

function Row({ label, row, total }) {
  const weight = total ? { fontWeight: 800 } : null
  return (
    <tr>
      <th scope="row" style={{ ...cell, textAlign: 'left', fontSize: 13, color: D.text, fontWeight: total ? 800 : 600, ...weight }}>{label}</th>
      <td style={{ ...cell, color: D.text, fontVariantNumeric: 'tabular-nums', ...weight }}>{row.orders}</td>
      {COLUMNS.map(([key]) => (
        <td key={key} style={cell}>
          <span data-amount style={{ ...s.amount, ...weight }}>{signedGhs(row[key])}</span>
        </td>
      ))}
    </tr>
  )
}

export default function DailySummary() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const { data, error, isLoading } = useVendorDaily({ dateFrom, dateTo })
  const rangeError = error?.status === 400 ? error : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ flex: '1 1 140px', minWidth: 0 }}>
          <span style={s.label}>From</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={s.field} />
        </label>
        <label style={{ flex: '1 1 140px', minWidth: 0 }}>
          <span style={s.label}>To</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={s.field} />
        </label>
      </div>
      {rangeError && <div role="alert" style={s.error}>{walletMessage(rangeError).text}</div>}
      {isLoading && <div style={s.note}>Loading…</div>}
      {error && !rangeError && <div role="alert" style={s.error}>{walletMessage(error).text}</div>}
      {data && !rangeError && (
        <div style={s.card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, color: D.text }}>{data.from} to {data.to}</h3>
          {data.days.length === 0 ? (
            <div style={s.note}>Nothing moved in this range.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th scope="col" style={{ ...head, textAlign: 'left' }}>Day</th>
                    <th scope="col" style={head}>Sales paid</th>
                    {COLUMNS.map(([key, label]) => <th key={key} scope="col" style={head}>{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.days.map((d) => <Row key={d.day} label={d.day} row={d} />)}
                  <Row label="Total" row={data.totals} total />
                </tbody>
              </table>
            </div>
          )}
          <div style={{ ...s.note, marginTop: 12 }}>Days when nothing moved are left out.</div>
          <div style={s.note}>Sold − platform fees − refunded − free-delivery promo − withdrawn + other = the change in your Pending and Available.</div>
        </div>
      )}
    </div>
  )
}
