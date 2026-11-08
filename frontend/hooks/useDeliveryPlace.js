import { useCallback, useEffect, useRef, useState } from 'react'
import { placeFromChoice, placeFromGeocode, readStoredPlace, storePlace } from '../lib/deliveryPlace.js'
import { reverseGeocodePlace } from '../lib/reverseGeocode.js'

// Where this shopper is, as a suggestion they confirm: `locate()` asks the browser for the position and
// reverse-geocodes it to a Ghana region or a country. The browser shows its own permission prompt, and only when the
// shopper taps "Use my current location": nothing asks for the location (or opens a panel) by itself on arrival, since
// a permission prompt before the visitor has done anything is routinely refused and then blocks the later, wanted ask.
// Nothing is stored until `choose()`.
// `place` is the confirmed choice (localStorage); `suggestion` is what was detected and awaits a yes.
export function useDeliveryPlace() {
  const [place, setPlace] = useState(() => readStoredPlace())
  const [suggestion, setSuggestion] = useState(null)
  const [status, setStatus] = useState('idle') // idle | locating | failed | unsupported
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])

  const choose = useCallback((next) => {
    const resolved = next && next.name ? next : placeFromChoice(next || {})
    storePlace(resolved)
    setPlace(resolved)
    setSuggestion(null)
    setStatus('idle')
  }, [])

  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setStatus('unsupported'); return }
    setStatus('locating')
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const found = await reverseGeocodePlace(coords.latitude, coords.longitude)
        if (!live.current) return
        const detected = placeFromGeocode(found)
        if (detected) { setSuggestion(detected); setStatus('idle') } else setStatus('failed')
      },
      () => { if (live.current) setStatus('failed') },
      { timeout: 8000, maximumAge: 10 * 60_000 },
    )
  }, [])

  return { place, suggestion, status, locate, choose, dismissSuggestion: () => setSuggestion(null) }
}
