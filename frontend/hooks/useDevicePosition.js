import { useCallback, useEffect, useRef, useState } from 'react'

// One location reading, on request only (the scout taps "Use my location") —
// the position is never watched or tracked between readings. High accuracy,
// no cached fix, and a 15 s limit so a phone indoors gives up instead of
// spinning.
export const POSITION_OPTIONS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }

export const LOCATION_BLOCKED =
  'Location is blocked for AshantiHub on this phone. To allow it, tap the lock (or ⓘ) next to the web address, set Location to Allow, then tap “Use my location” again.'
const LOCATION_SLOW = "Couldn't get a location fix in time. Step outside, away from walls, and try again."
const LOCATION_UNAVAILABLE = "Your phone couldn't work out where you are. Turn on Location (GPS) in your phone's settings and try again."
const LOCATION_UNSUPPORTED = "This browser can't share its location. Place the pin by hand instead."

export function useDevicePosition() {
  const [position, setPosition] = useState(null)
  const [error, setError] = useState(null)
  const [locating, setLocating] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const locate = useCallback(() => {
    const geo = typeof navigator === 'undefined' ? undefined : navigator.geolocation
    if (!geo) {
      setError(LOCATION_UNSUPPORTED)
      return
    }
    setError(null)
    setLocating(true)
    geo.getCurrentPosition(
      (pos) => {
        if (!mounted.current) return
        setLocating(false)
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
          at: new Date(pos.timestamp || Date.now()).toISOString(),
        })
      },
      (err) => {
        if (!mounted.current) return
        setLocating(false)
        setError(err?.code === 1 ? LOCATION_BLOCKED : err?.code === 3 ? LOCATION_SLOW : LOCATION_UNAVAILABLE)
      },
      POSITION_OPTIONS,
    )
  }, [])

  return { position, error, locating, locate }
}
