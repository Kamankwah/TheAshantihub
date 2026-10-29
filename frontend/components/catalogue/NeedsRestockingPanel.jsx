import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiPost } from '../../apiClient.js'
import { useNeedsRestocking } from '../../hooks/useCatalogueStock.js'
import { useMyListings } from '../../hooks/useMyListings.js'
import { apiErrorMessage } from '../../lib/apiErrorMessage.js'
import { D, glassCard, tint } from '../dashboard/theme.js'
import { STOCK_COUNT_HELP, coverSentence } from './catalogueFormat.js'
import StockLineEditor from './StockLineEditor.jsx'

const note = { color: D.textDim, fontSize: '0.74rem', margin: '4px 0 0' }
const btn = { border: `1px solid ${D.divider}`, borderRadius: 20, padding: '7px 14px', fontSize: '0.74rem', fontWeight: 700, fontFamily: 'inherit', background: D.panelBg2, color: D.text, cursor: 'pointer' }
const input = { padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${D.divider}`, fontSize: '0.8rem', fontFamily: 'inherit', background: D.panelBg2, color: D.text, width: 110 }

function Chip({ soldOut }) {
  const color = soldOut ? D.red : D.amber
  return <span style={{ background: tint(color, '22'), color, borderRadius: 20, padding: '2px 10px', fontSize: '0.66rem', fontWeight: 800 }}>{soldOut ? 'Sold out' : 'Low stock'}</span>
}

function RestockBox({ listingId, name }) {
  const qc = useQueryClient()
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const restock = async () => {
    const t = qty.trim()
    if (!/^[1-9]\d*$/.test(t)) { setError('Enter a whole number of units, 1 or more.'); return }
    setBusy(true); setError(null)
    try {
      await apiPost(`/api/listings/mine/${listingId}/restock/`, { add: Number(t) })
      setQty('')
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['catalogue-stock'] }),
        qc.invalidateQueries({ queryKey: ['my-listings'] }),
      ])
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not restock. Please try again.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input inputMode="numeric" aria-label={`Units to add to ${name}`} placeholder="Units to add" value={qty} onChange={(e) => setQty(e.target.value)} style={input} />
      <button type="button" disabled={busy} onClick={restock} style={{ ...btn, background: D.gold, color: D.darkBrown, border: 'none' }}>Restock</button>
      {error && <div role="alert" style={{ color: D.errInk, background: D.errBg, borderRadius: 8, padding: '6px 8px', fontSize: '0.74rem', flexBasis: '100%' }}>{error}</div>}
    </div>
  )
}

function Row({ row, settings, hasVariants }) {
  const [lineOpen, setLineOpen] = useState(false)
  return (
    <li style={{ ...glassCard, padding: 14, marginBottom: 10, listStyle: 'none' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: D.text, fontWeight: 800, fontSize: '0.88rem' }}>{row.name}</span>
        <Chip soldOut={row.sold_out} />
      </div>
      <p style={note}>{coverSentence(row, settings)}</p>
      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {hasVariants
          ? <span style={{ color: D.textDim, fontSize: '0.74rem' }}>Restock each option on its card under Your products.</span>
          : <RestockBox listingId={row.listing_id} name={row.name} />}
        <button type="button" onClick={() => setLineOpen((o) => !o)} aria-expanded={lineOpen} style={btn}>Alert line…</button>
      </div>
      {lineOpen && <StockLineEditor listingId={row.listing_id} />}
    </li>
  )
}

export default function NeedsRestockingPanel() {
  const stock = useNeedsRestocking()
  const mine = useMyListings()
  if (stock.isLoading) return <div style={{ color: D.textDim }}>Loading…</div>
  if (stock.isError) return <div role="alert" style={{ color: D.red }}>Could not load your stock. Please try again.</div>

  const pages = stock.data?.pages ?? []
  const first = pages[0] ?? {}
  const settings = first.settings ?? {}
  const rows = pages.flatMap((p) => p.results ?? [])
  const myRows = Array.isArray(mine.data) ? mine.data : mine.data?.results ?? []
  const variantIds = new Set(myRows.filter((l) => l.has_variants).map((l) => l.id))

  return (
    <section>
      <h3 style={{ color: D.text, margin: 0 }}>Needs restocking</h3>
      <p style={note}>
        {first.tracked_offers} of your products have a stock count.
        {first.untracked_offers > 0 && ` ${first.untracked_offers} don't, so we can't tell when they run low.`}
      </p>
      <p style={note}>
        A product counts as low when fewer than {settings.cover_days} days of sales are left, or, with no sales in {settings.window_days} days, at {settings.fallback_units} or fewer. You can set your own line per product.
      </p>
      <p style={note}>{STOCK_COUNT_HELP}</p>
      {settings.sold_out_hidden && <p style={note}>Sold-out products don't show in search until you restock.</p>}
      {settings.alerts_enabled && <p style={note}>We also tell you in your notifications when a product first runs low or sells out.</p>}

      {rows.length === 0 ? (
        <p style={{ ...note, marginTop: 14 }}>Nothing needs restocking right now.</p>
      ) : (
        <ul style={{ padding: 0, margin: '14px 0 0' }}>
          {rows.map((row) => <Row key={row.listing_id} row={row} settings={settings} hasVariants={variantIds.has(row.listing_id)} />)}
        </ul>
      )}
      {stock.hasNextPage && (
        <div>
          <button type="button" disabled={stock.isFetchingNextPage} onClick={() => stock.fetchNextPage()} style={btn}>Load more</button>
          <span style={{ ...note, marginLeft: 8 }}>Showing {rows.length} of {first.count}</span>
        </div>
      )}
    </section>
  )
}
