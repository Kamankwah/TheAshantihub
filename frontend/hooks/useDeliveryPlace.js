import { useCallback, useEffect, useRef, useState } from 'react'
import { placeFromChoice, placeFromGeocode, readStoredPlace, storePlace } from '../lib/deliveryPlace.js'
import { reverseGeocodePlace } from '../lib/reverseGeocode.js'

const ASKED_KEY = 'ashantihub.deliverToAsked'

// Where this shopper is, as a suggestion they confirm: `locate()` asks the browser for the position (the browser
// shows its own permission prompt, so it only ever runs from a tap, or on arrival when the shopper has already
// allowed it) and reverse-geocodes it to a Ghana region or a country. Nothing is stored until `choose()`.
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

  // On arrival with nothing chosen: locate by itself only when the shopper has already allowed location.
  useEffect(() => {
    if (place || typeof navigator === 'undefined' || !navigator.permissions?.query) return
    navigator.permissions.query({ name: 'geolocation' }).then((p) => { if (live.current && p.state === 'granted') locate() }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { place, suggestion, status, locate, choose, dismissSuggestion: () => setSuggestion(null) }
}

// The panel opens by itself once per browser session while nothing is chosen (the first visit's "where to?").
export function shouldAutoAsk(place) {
  if (place) return false
  try {
    if (sessionStorage.getItem(ASKED_KEY)) return false
    sessionStorage.setItem(ASKED_KEY, '1')
  } catch {
    return false
  }
  return true
}
