import { useRef, useState } from 'react'
import { apiPatch, apiPost } from '../../apiClient.js'
import { ghanaPostError, normalizeGhanaPost } from '../../lib/ghanaPost.js'
import LocationPicker from '../LocationPicker.jsx'
import { walletStyles } from '../wallet/walletStyles.js'
import GhanaPostField from './GhanaPostField.jsx'

const BASE = '/api/accounts/addresses/'
const LANDMARK_BLANK = 'Add a landmark near your door so the rider can find you.'
const LANDMARK_LONG = 'Keep the landmark under 200 characters.'

// First message of a DRF field error ("x" or ["x", ...]).
const first = (v) => (Array.isArray(v) ? v[0] : v)
const num = (v) => (v == null || v === '' ? null : Number(v))

// Add or edit one address. `initial` (a saved row) makes it an edit. Saves with
// a plain apiPost / apiPatch; the server's field errors are shown verbatim
// beside their fields. `onSave(row)` gets the saved row (is_default current).
export default function AddressForm({ initial = null, onSave, onCancel }) {
  const s = walletStyles('light')
  const [label, setLabel] = useState(initial?.label ?? 'Home')
  const [name, setName] = useState(initial?.recipient_name ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [gps, setGps] = useState(initial?.gps_address ?? '')
  const [landmark, setLandmark] = useState(initial?.landmark ?? '')
  const [street, setStreet] = useState(initial?.address_text ?? '')
  const [lat, setLat] = useState(num(initial?.lat))
  const [lng, setLng] = useState(num(initial?.lng))
  const [makeDefault, setMakeDefault] = useState(Boolean(initial?.is_default))
  const [errors, setErrors] = useState({})
  const [actionError, setActionError] = useState(null)
  const [busy, setBusy] = useState(false)
  const streetAuto = useRef(false)
  const savedRow = useRef(null) // set once the row exists, so a retry after a failed set-default patches instead of duplicating

  function onStreet(v) {
    streetAuto.current = false
    setStreet(v)
  }
  // The map's reverse geocode fills the street text only (never the GhanaPost code),
  // and never over text the shopper typed.
  function onMapAddress(text) {
    if (!text) return
    if (street.trim() && !streetAuto.current) return
    streetAuto.current = true
    setStreet(text)
  }

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    const code = normalizeGhanaPost(gps)
    const note = landmark.trim()
    const found = {}
    if (!label.trim()) found.label = 'Give this address a name, for example Home.'
    if (!name.trim()) found.recipient_name = 'Who should the rider ask for?'
    if (!phone.trim()) found.phone = 'Enter a Ghana phone number, for example 024 123 4567.'
    const gpsErr = ghanaPostError(code)
    if (gpsErr) found.gps_address = gpsErr
    if (!note) found.landmark = LANDMARK_BLANK
    else if (note.length > 200) found.landmark = LANDMARK_LONG
    setErrors(found)
    setActionError(null)
    if (Object.keys(found).length) return

    const body = {
      label: label.trim(), recipient_name: name.trim(), phone: phone.trim(), gps_address: code,
      landmark: note, address_text: street.trim(),
      lat: lat == null ? null : lat.toFixed(6), lng: lng == null ? null : lng.toFixed(6),
    }
    setBusy(true)
    let existed = false // this submit's save worked; only the set-default after it can still have failed
    try {
      const existingId = savedRow.current?.id ?? initial?.id
      let row = existingId ? await apiPatch(`${BASE}${existingId}/`, body) : await apiPost(BASE, body)
      savedRow.current = row
      existed = true
      if (makeDefault && !row.is_default) row = await apiPost(`${BASE}${row.id}/set-default/`, {})
      savedRow.current = row
      onSave?.(row)
    } catch (err) {
      if (existed) {
        setErrors({})
        setActionError('Saved, but we could not make it your default.')
        return
      }
      const b = err?.body
      if (b && typeof b === 'object') {
        const fields = {}
        for (const k of ['label', 'recipient_name', 'phone', 'gps_address', 'landmark', 'address_text', 'lat', 'lng']) {
          if (b[k]) fields[k] = first(b[k])
        }
        setErrors(fields)
        if (b.detail && !Object.keys(fields).length) setActionError(first(b.detail))
        else if (!Object.keys(fields).length) setActionError('We could not save this address. Please try again.')
      } else {
        setActionError('We could not save this address. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  const text = (id, labelText, value, set, extra = {}) => (
    <div>
      <label htmlFor={`addr-${id}`} style={s.label}>{labelText}</label>
      <input
        id={`addr-${id}`} style={s.field} value={value} onChange={(e) => set(e.target.value)}
        aria-invalid={errors[id] ? true : undefined} {...extra}
      />
      {errors[id] && <div role="alert" style={{ ...s.note, color: s.error.color, marginTop: 4 }}>{errors[id]}</div>}
    </div>
  )

  return (
    <form onSubmit={submit} noValidate style={{ ...s.card, display: 'grid', gap: 14 }} aria-label={initial ? 'Edit address' : 'Add address'}>
      {text('label', 'Address name', label, setLabel, { maxLength: 60, placeholder: 'Home' })}
      {text('recipient_name', 'Recipient name', name, setName, { maxLength: 150, autoComplete: 'name' })}
      {text('phone', 'Phone number', phone, setPhone, { inputMode: 'tel', autoComplete: 'tel', placeholder: '024 123 4567' })}
      <GhanaPostField value={gps} onChange={setGps} error={errors.gps_address} />
      <div>
        <label htmlFor="addr-landmark" style={s.label}>Landmark near your door</label>
        <input
          id="addr-landmark" style={s.field} value={landmark} onChange={(e) => setLandmark(e.target.value)}
          placeholder="Opposite the Total filling station" aria-invalid={errors.landmark ? true : undefined}
        />
        {errors.landmark && <div role="alert" style={{ ...s.note, color: s.error.color, marginTop: 4 }}>{errors.landmark}</div>}
      </div>
      {text('address_text', 'Street or area (optional)', street, onStreet, { maxLength: 255, autoComplete: 'street-address' })}
      <div>
        <div style={s.label}>Pin your door on the map (optional)</div>
        <LocationPicker lat={lat} lng={lng} onChange={(la, ln) => { setLat(la); setLng(ln) }} onAddress={onMapAddress} height={200} />
        <div style={{ ...s.note, marginTop: 4 }}>The pin and street text help the rider; the Ghana Post code above is what we deliver to.</div>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 15, color: s.value.color }}>
        <input type="checkbox" checked={makeDefault} disabled={Boolean(initial?.is_default)} onChange={(e) => setMakeDefault(e.target.checked)} />
        Make this my default
      </label>
      {actionError && <div role="alert" style={s.error}>{actionError}</div>}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button type="submit" style={s.button} disabled={busy}>{busy ? 'Saving…' : 'Save address'}</button>
        {onCancel && <button type="button" style={s.ghost} onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
    </form>
  )
}
