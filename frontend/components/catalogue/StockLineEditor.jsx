import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiPut } from '../../apiClient.js'
import { useStockLine } from '../../hooks/useCatalogueStock.js'
import { apiErrorMessage } from '../../lib/apiErrorMessage.js'
import { D } from '../dashboard/theme.js'
import { coverSentence } from './catalogueFormat.js'

// The business's own low-stock line for one product. Empty means AshantiHub's
// default (null); 0 is a real line. The value is sent as typed: the server parses it.
const input = { padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${D.divider}`, fontSize: '0.8rem', fontFamily: 'inherit', background: D.panelBg2, color: D.text, width: 110 }
const btn = { border: `1px solid ${D.divider}`, borderRadius: 20, padding: '7px 14px', fontSize: '0.74rem', fontWeight: 700, fontFamily: 'inherit', background: D.panelBg2, color: D.text, cursor: 'pointer' }

export default function StockLineEditor({ listingId, onSaved, settings }) {
  const qc = useQueryClient()
  const { data, isLoading, isError } = useStockLine(listingId)
  const [typed, setTyped] = useState(null) // null: untouched, show the saved line
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)

  if (isLoading) return <div style={{ color: D.textDim, fontSize: '0.74rem' }}>Loading…</div>
  if (isError || !data) return <div role="alert" style={{ color: D.red, fontSize: '0.74rem' }}>Could not load the alert line.</div>

  const value = typed ?? (data.line == null ? '' : String(data.line))

  const put = async (units) => {
    setBusy(true); setError(null); setSaved(null)
    try {
      await apiPut(`/api/catalogue/stock/${listingId}/line/`, { units })
      await qc.invalidateQueries({ queryKey: ['catalogue-stock'] })
      setTyped(null)
      const trimmed = units == null ? null : String(units).trim()
      setSaved(trimmed == null || trimmed === ''
        ? "Saved. Using AshantiHub's default."
        : `Saved. It shows in Needs restocking at ${trimmed} or fewer.`)
      if (onSaved) onSaved()
    } catch (err) {
      setError(err?.body?.units ?? apiErrorMessage(err, 'Could not save the alert line. Please try again.'))
    } finally {
      setBusy(false)
    }
  }
  const save = () => { const t = value.trim(); return put(t === '' ? null : t) }
  const useDefault = () => { setTyped(null); return put(null) }

  return (
    <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: D.panelBg2, border: `1px solid ${D.divider}` }}>
      <div style={{ color: D.text, fontSize: '0.78rem', fontWeight: 700 }}>
        {data.line == null ? "Using AshantiHub's default" : `Your alert line: ${data.line} units`}
      </div>
      {data.cover == null ? (
        <div style={{ color: D.textDim, fontSize: '0.74rem', marginTop: 4 }}>Count this product's stock first to set an alert line.</div>
      ) : (
        <>
          <div style={{ color: D.textDim, fontSize: '0.74rem', marginTop: 4 }}>{coverSentence(data.cover, settings)}</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <label style={{ color: D.textDim, fontSize: '0.72rem' }}>
              Alert me at or below (units){' '}
              <input inputMode="numeric" value={value} onChange={(e) => setTyped(e.target.value)} style={input} />
            </label>
            <button type="button" disabled={busy} onClick={save} style={{ ...btn, background: D.gold, color: D.darkBrown, border: 'none' }}>Save</button>
            <button type="button" disabled={busy} onClick={useDefault} style={btn}>Use the default</button>
          </div>
        </>
      )}
      {error && <div role="alert" style={{ color: D.errInk, background: D.errBg, borderRadius: 8, padding: '6px 8px', fontSize: '0.74rem', marginTop: 6 }}>{error}</div>}
      {saved && <div role="status" style={{ color: D.okInk, background: D.okBg, borderRadius: 8, padding: '6px 8px', fontSize: '0.74rem', marginTop: 6 }}>{saved}</div>}
    </div>
  )
}
