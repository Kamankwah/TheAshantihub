import { useState } from 'react'
import { useCatalogueSearch } from '../../hooks/useCatalogueLookup.js'
import { apiErrorMessage } from '../../lib/apiErrorMessage.js'
import { D, glassCard } from '../dashboard/theme.js'
import { displayBarcode, formatPrice } from './catalogueFormat.js'

const note = { color: D.textDim, fontSize: '0.74rem', margin: '4px 0 0' }
const input = { padding: '9px 12px', borderRadius: 8, border: `1.5px solid ${D.divider}`, fontSize: '0.84rem', fontFamily: 'inherit', background: D.panelBg2, color: D.text, flex: '1 1 220px', minWidth: 0 }
const btn = { border: `1px solid ${D.divider}`, borderRadius: 20, padding: '7px 14px', fontSize: '0.74rem', fontWeight: 700, fontFamily: 'inherit', background: D.panelBg2, color: D.text, cursor: 'pointer' }

// A term that is all digits once spaces and hyphens are removed is a barcode.
function toTerm(text) {
  const t = text.trim()
  if (!t) return null
  const compact = t.replace(/[\s-]/g, '')
  return /^\d+$/.test(compact) ? { barcode: compact } : { q: t }
}

export default function CatalogueSearch({ onPick, pickLabel = 'See offers', initialTerm = '' }) {
  const [text, setText] = useState(initialTerm)
  const [term, setTerm] = useState(null)
  const { data, error, isFetching } = useCatalogueSearch(term)
  const submit = (e) => { e.preventDefault(); setTerm(toTerm(text)) }
  const results = data?.results ?? []
  return (
    <div>
      <form onSubmit={submit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input aria-label="Product name or barcode" placeholder="Product name or barcode" value={text} onChange={(e) => setText(e.target.value)} style={input} />
        <button type="submit" style={{ ...btn, background: D.gold, color: D.darkBrown, border: 'none' }}>Search</button>
      </form>
      {error && <div role="alert" style={{ color: D.errInk, background: D.errBg, borderRadius: 8, padding: '8px 10px', fontSize: '0.78rem', marginTop: 10 }}>{apiErrorMessage(error, 'Could not search the catalogue. Please try again.')}</div>}
      {isFetching && <p style={note}>Searching…</p>}
      {data && !isFetching && (
        <div style={{ marginTop: 12 }}>
          {results.length === 0 && <p style={note}>No catalogue product matches.</p>}
          <ul style={{ padding: 0, margin: 0 }}>
            {results.map((row) => (
              <li key={row.id} style={{ ...glassCard, padding: 14, marginBottom: 10, listStyle: 'none', display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ color: D.text, fontWeight: 800, fontSize: '0.88rem' }}>{`${row.brand} ${row.name}`.trim()}</div>
                  {row.barcode && <div style={{ ...note, fontVariantNumeric: 'tabular-nums' }}>{displayBarcode(row.barcode)}</div>}
                  <div style={note}>{row.offer_count} live {row.offer_count === 1 ? 'offer' : 'offers'}</div>
                  <div style={{ ...note, color: D.price, fontVariantNumeric: 'tabular-nums' }}>
                    {row.lowest_price != null && row.offer_count > 0 ? `Lowest listed price ${formatPrice(row.lowest_price)}` : 'No live offers now'}
                  </div>
                </div>
                <button type="button" style={btn} onClick={() => onPick?.(row)}>{pickLabel}</button>
              </li>
            ))}
          </ul>
          {data.truncated && <p style={note}>More products matched than shown. Add a word or search by barcode.</p>}
        </div>
      )}
    </div>
  )
}
