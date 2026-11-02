import { useCallback, useEffect, useRef, useState } from 'react'
import { placeFromChoice, placeFromGeocode, readStoredPlace, storePlace } from '../lib/deliveryPlace.js'
import { reverseGeocodePlace } from '../lib/reverseGeocode.js'

const ASKED_KEY = 'ashantihub.deliverToAsked'
const LOCATED_KEY = 'ashantihub.deliverToLocated'

// Where this shopper is, as a suggestion they confirm: `locate()` asks the browser for the position and
// reverse-geocodes it to a Ghana region or a country. The browser shows its own permission prompt; on arrival with
// no choice made the page asks once per session (never when the shopper has blocked location for the site), and the
// "Use my current location" button asks again on demand. Nothing is stored until `choose()`.
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

  // On arrival with nothing chosen: ask the browser for the location once per session. A blocked site is never asked.
  useEffect(() => {
    if (place || typeof navigator === 'undefined' || !navigator.geolocation) return
    try {
      if (sessionStorage.getItem(LOCATED_KEY)) return
      sessionStorage.setItem(LOCATED_KEY, '1')
    } catch {
      return
    }
    if (!navigator.permissions?.query) { locate(); return }
    navigator.permissions.query({ name: 'geolocation' })
      .then((p) => { if (live.current && p.state !== 'denied') locate() })
      .catch(() => { if (live.current) locate() })
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
