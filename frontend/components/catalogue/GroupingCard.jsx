import { useRef, useState } from 'react'
import { apiPost } from '../../apiClient.js'
import { useGroupingState } from '../../hooks/useCatalogueGrouping.js'
import { apiErrorMessage } from '../../lib/apiErrorMessage.js'
import { D, glassCard } from '../dashboard/theme.js'
import CatalogueSearch from './CatalogueSearch.jsx'
import { displayBarcode } from './catalogueFormat.js'

const note = { color: D.textDim, fontSize: '0.76rem', margin: '6px 0 0' }
const text = { color: D.text, fontSize: '0.8rem', margin: '6px 0 0' }
const btn = { border: `1px solid ${D.divider}`, borderRadius: 20, padding: '7px 14px', fontSize: '0.74rem', fontWeight: 700, fontFamily: 'inherit', background: D.panelBg2, color: D.text, cursor: 'pointer' }
const primary = { ...btn, background: D.gold, color: D.darkBrown, border: 'none' }
const input = { padding: '9px 12px', borderRadius: 8, border: `1.5px solid ${D.divider}`, fontSize: '0.84rem', fontFamily: 'inherit', background: D.panelBg2, color: D.text, flex: '1 1 180px', minWidth: 0 }

const name = (p) => `${p.brand} ${p.name}`.trim()

export default function GroupingCard({ listing }) {
  const [opened, setOpened] = useState(false)
  const [mode, setMode] = useState('find')
  const [brand, setBrand] = useState(listing.brand ?? '')
  const [productName, setProductName] = useState(listing.name ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const { data, refetch } = useGroupingState(listing.id, { enabled: opened })

  if (data && data.groupable === false) return null

  async function run(path, body, fallback) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      await apiPost(path, body)
      await refetch()
    } catch (e) {
      setError(apiErrorMessage(e, fallback))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const ask = (body) => run(`/api/catalogue/mine/${listing.id}/requests/`, body, 'Could not send the request. Please try again.')
  const withdraw = (request) => {
    if (!window.confirm('Take back this request?')) return
    run(`/api/catalogue/mine/requests/${request.id}/withdraw/`, {}, 'Could not take back the request. Please try again.')
  }

  const request = data?.request
  const pending = request?.status === 'pending'
  const canAsk = data && !data.catalogue_product && !pending
  const searchTerm = data && data.barcode && !data.store_code ? displayBarcode(data.barcode) : ''

  return (
    <div style={{ ...glassCard, padding: 12, marginTop: 12 }}>
      <button type="button" aria-expanded={opened} onClick={() => setOpened((o) => !o)} style={{ ...btn, border: 'none', background: 'transparent', padding: 0 }}>
        Other sellers of this product
      </button>
      {opened && data && (
        <div>
          {data.catalogue_product && (
            <p style={text}>Shown with other sellers of {name(data.catalogue_product)}. Only AshantiHub can ungroup it; ask Support if this is wrong.</p>
          )}
          {pending && request.source === 'backfill' && <p style={text}>AshantiHub found this match by barcode and will decide it.</p>}
          {pending && request.source !== 'backfill' && (
            <div>
              <p style={text}>Waiting for AshantiHub: {request.catalogue_product ? name(request.catalogue_product) : `new: ${name(request)}`}</p>
              <button type="button" disabled={busy} onClick={() => withdraw(request)} style={btn}>Withdraw</button>
            </div>
          )}
          {request?.status === 'rejected' && !data.catalogue_product && <p style={text}>Not grouped: {request.rejection_reason}</p>}
          {canAsk && (
            <div>
              {request?.status !== 'rejected' && <p style={text}>Sell the same branded product as other shops? Ask AshantiHub to show your offer with theirs.</p>}
              {data.store_code
                ? <p style={note}>This is a shop's own code, so it cannot be matched. Ask with the brand and name.</p>
                : data.barcode
                  ? <p style={{ ...note, fontVariantNumeric: 'tabular-nums' }}>Barcode {displayBarcode(data.barcode)}</p>
                  : <p style={note}>No barcode on this listing. Add it under Edit details, or ask with the brand.</p>}
              <div style={{ display: 'flex', gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
                <button type="button" aria-pressed={mode === 'find'} onClick={() => setMode('find')} style={mode === 'find' ? primary : btn}>Find the product</button>
                <button type="button" aria-pressed={mode === 'new'} onClick={() => setMode('new')} style={mode === 'new' ? primary : btn}>It's not listed</button>
              </div>
              {mode === 'find' && (
                <CatalogueSearch pickLabel="Ask to join" initialTerm={searchTerm} onPick={(row) => ask({ catalogue_product: row.id })} />
              )}
              {mode === 'new' && (
                <form onSubmit={(e) => { e.preventDefault(); ask({ brand: brand.trim(), name: productName.trim() }) }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input aria-label="Brand" placeholder="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} style={input} />
                  <input aria-label="Product name" placeholder="Product name" value={productName} onChange={(e) => setProductName(e.target.value)} style={input} />
                  <button type="submit" disabled={busy} style={primary}>Ask AshantiHub to group it</button>
                </form>
              )}
              <p style={note}>AshantiHub staff check every request. Nothing changes until they approve.</p>
            </div>
          )}
          {error && <div role="alert" style={{ color: D.errInk, background: D.errBg, borderRadius: 8, padding: '8px 10px', fontSize: '0.78rem', marginTop: 10 }}>{error}</div>}
        </div>
      )}
    </div>
  )
}
