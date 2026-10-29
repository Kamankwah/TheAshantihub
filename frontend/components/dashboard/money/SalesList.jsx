import { useEffect, useState } from 'react'
import { useVendorBookings, useVendorSales } from '../../../hooks/useVendorMoney.js'
import { walletMessage } from '../../wallet/walletErrors.js'
import { walletStyles } from '../../wallet/walletStyles.js'
import { D } from '../theme.js'
import { SALE_FILTERS } from './moneyWords.js'
import { BookingSaleRow, OrderSaleRow } from './SaleRows.jsx'

// The per-sale list: orders or bookings, status filter, date range, Load more.
// Hooks are paginated (DRF envelope: data.results / data.next). Owner-only.
const s = walletStyles('dashboard')

function pill(on) {
  return {
    background: on ? D.gold : 'transparent', color: on ? D.darkBrown : D.text,
    border: `1px solid ${on ? D.gold : D.cardBorder}`, borderRadius: 999, padding: '8px 14px',
    fontSize: 13, fontWeight: 700, cursor: 'pointer', minHeight: 44,
  }
}

function SalesPage({ source, status, dateFrom, dateTo, page, onLoaded, onRangeError }) {
  const args = { status, dateFrom, dateTo, page }
  const sales = useVendorSales({ ...args, enabled: source === 'orders' })
  const bookings = useVendorBookings({ ...args, enabled: source === 'bookings' })
  const { data, error, isLoading, refetch } = source === 'orders' ? sales : bookings
  const rangeError = page === 1 && error?.status === 400 ? error : null

  useEffect(() => { if (data) onLoaded(Boolean(data.next)) }, [data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (page === 1) onRangeError(rangeError)
  }, [rangeError]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <div style={s.note}>Loading…</div>
  if (error && !rangeError) {
    return (
      <div role="alert" style={s.error}>
        {walletMessage(error).text}{' '}
        <button type="button" style={s.ghost} onClick={() => refetch()}>Try again</button>
      </div>
    )
  }
  if (!data) return null
  if (page === 1 && data.results.length === 0) {
    return <div style={s.note}>{source === 'orders' ? 'No sales in this range yet.' : 'No bookings in this range yet.'}</div>
  }
  const Row = source === 'orders' ? OrderSaleRow : BookingSaleRow
  return data.results.map((row, i) => <Row key={`${row.order ?? row.sale ?? i}-${i}`} row={row} />)
}

export default function SalesList({ businessKind }) {
  const [source, setSource] = useState(businessKind === 'service' ? 'bookings' : 'orders')
  const [status, setStatus] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [pages, setPages] = useState(1)
  const [more, setMore] = useState(false)
  const [rangeError, setRangeError] = useState(null)

  const change = (setter) => (value) => { setter(value); setPages(1); setMore(false); setRangeError(null) }
  const pick = change(setSource)
  const filter = change(setStatus)
  const from = change(setDateFrom)
  const to = change(setDateTo)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" aria-pressed={source === 'orders'} style={pill(source === 'orders')} onClick={() => pick('orders')}>Orders</button>
        <button type="button" aria-pressed={source === 'bookings'} style={pill(source === 'bookings')} onClick={() => pick('bookings')}>Bookings</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {SALE_FILTERS.map((f) => (
          <button key={f.value} type="button" aria-pressed={status === f.value} style={pill(status === f.value)} onClick={() => filter(f.value)}>{f.label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ flex: '1 1 140px', minWidth: 0 }}>
          <span style={s.label}>From</span>
          <input type="date" value={dateFrom} onChange={(e) => from(e.target.value)} style={s.field} />
        </label>
        <label style={{ flex: '1 1 140px', minWidth: 0 }}>
          <span style={s.label}>To</span>
          <input type="date" value={dateTo} onChange={(e) => to(e.target.value)} style={s.field} />
        </label>
      </div>
      {rangeError && <div role="alert" style={s.error}>{walletMessage(rangeError).text}</div>}
      {Array.from({ length: pages }, (_, i) => i + 1).map((page) => (
        <SalesPage
          key={`${source}|${status}|${dateFrom}|${dateTo}|${page}`}
          source={source} status={status} dateFrom={dateFrom} dateTo={dateTo} page={page}
          onLoaded={(next) => { if (page === pages) setMore(next) }}
          onRangeError={setRangeError}
        />
      ))}
      {more && (
        <button type="button" style={s.ghost} onClick={() => { setMore(false); setPages(pages + 1) }}>Load more</button>
      )}
    </div>
  )
}
