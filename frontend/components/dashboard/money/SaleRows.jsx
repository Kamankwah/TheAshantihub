import { signedGhs, formatGhs } from '../../wallet/walletMoney.js'
import { walletStyles } from '../../wallet/walletStyles.js'
import { D } from '../theme.js'
import { releaseLine, statusColor } from './moneyWords.js'

// One sale per row for the business owner. Rows render only the fields named here: never a
// customer name, phone or address (privacy V5), and nothing joined in from order or booking hooks.
// Owner-only: it shows platform fees.
const s = walletStyles('dashboard')
const NONE = '0.00'

const day = (iso) => (iso ? String(iso).slice(0, 10) : '')

function Line({ label, value, signed = false }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
      <span style={{ color: D.textDim, minWidth: 0 }}>{label}</span>
      <span data-amount style={s.amount}>{signed ? signedGhs(value) : formatGhs(value)}</span>
    </div>
  )
}

function Chip({ row }) {
  return (
    <span style={{
      color: statusColor(row), border: `1px solid ${statusColor(row)}`, borderRadius: 999,
      padding: '2px 10px', fontSize: 12, fontWeight: 700, maxWidth: '100%', overflowWrap: 'anywhere',
    }}>{row.status_label}</span>
  )
}

const rowBox = { ...s.card, padding: 16, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }
const head = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }

export function OrderSaleRow({ row }) {
  return (
    <div style={rowBox}>
      <div style={head}>
        <div>
          <div style={{ fontWeight: 700, color: D.text }}>{row.reference}</div>
          <div style={s.note}>{day(row.placed_at)}</div>
        </div>
        <Chip row={row} />
      </div>
      {(row.items || []).map((item, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
          <span style={{ color: D.text, minWidth: 0, overflowWrap: 'anywhere' }}>{item.name} × {item.quantity}</span>
          <span data-amount style={s.amount}>{formatGhs(item.line_total)}</span>
        </div>
      ))}
      <Line label="Item subtotal" value={row.item_subtotal} />
      {row.refunded !== NONE && <Line label="Refunded" value={row.refunded} />}
      <Line label="Platform fee" value={row.platform_fee} />
      {row.free_delivery_promo !== NONE && <Line label="Free-delivery promo" value={row.free_delivery_promo} />}
      <Line label="You get" value={row.net} signed />
      {row.released_at && <div style={s.note}>Released {day(row.released_at)}</div>}
    </div>
  )
}

export function BookingSaleRow({ row }) {
  const due = releaseLine(row)
  return (
    <div style={rowBox}>
      <div style={head}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: D.text, overflowWrap: 'anywhere' }}>
            {row.reference} · {row.booking_kind_label} · {row.what}
          </div>
          <div style={s.note}>Paid {day(row.placed_at)}</div>
        </div>
        <Chip row={row} />
      </div>
      <Line label="Price" value={row.item_subtotal} />
      {row.refunded !== NONE && <Line label="Refunded" value={row.refunded} />}
      <Line label="Platform fee" value={row.platform_fee} />
      <Line label="You get" value={row.net} signed />
      {due && <div style={s.note}>{due}</div>}
      {row.released_at && <div style={s.note}>Released {day(row.released_at)}</div>}
      {row.customer_accepted && <div style={s.note}>Accepted by the customer</div>}
    </div>
  )
}
