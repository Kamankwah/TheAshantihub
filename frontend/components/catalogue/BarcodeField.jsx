import { D } from '../dashboard/theme.js'
import { displayBarcode } from './catalogueFormat.js'
import { inputStyle, labelStyle } from '../dashboard/panels/listingFormFields.jsx'

const HELP = "8, 12, 13 or 14 digits as printed. A shop's own price-sticker code is kept but never matched with other shops."
const note = { fontSize: '0.68rem', color: D.textDim, marginTop: 4, lineHeight: 1.5 }

// The server's field error arrives as a DRF list or a string.
const errorText = (error) => (Array.isArray(error) ? error[0] : error) || ''

// A goods listing's barcode. `savedKey` is the key the server stored (listing.barcode), never the typed text.
export default function BarcodeField({ value, onChange, error, savedKey, id = 'listing-barcode' }) {
  const message = errorText(error)
  return (
    <div style={{ marginBottom: 10 }}>
      <label htmlFor={id} style={labelStyle}>Barcode</label>
      <input
        id={id} value={value ?? ''} inputMode="numeric" autoComplete="off"
        placeholder="Barcode on the pack (optional)"
        aria-describedby={`${id}-help`} aria-invalid={message ? true : undefined}
        onChange={(e) => onChange(e.target.value)} style={inputStyle}
      />
      <div id={`${id}-help`} style={note}>{HELP}</div>
      {savedKey ? <div style={note}>Saved as {displayBarcode(savedKey)}</div> : null}
      {message ? <div role="alert" style={{ color: D.red, fontSize: '0.72rem', marginTop: 4 }}>{message}</div> : null}
    </div>
  )
}
