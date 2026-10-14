import '@testing-library/jest-dom'
import { configure } from '@testing-library/react'
import { createElement } from 'react'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { server } from '../mocks/server.js'
import { resetNetworkStatusForTests } from '../lib/networkStatus.js'

// findBy*/waitFor poll up to 5 s (the default 1 s is too tight when the whole suite
// runs in parallel); they still return the moment the element is there.
configure({ asyncUtilTimeout: 5000 })

// Leaflet needs a real browser (sized DOM, canvas) and doesn't render under
// jsdom, so the two map components (item 11) are stubbed for every test. Their
// real behaviour is verified manually in the browser, not here. The
// LocationPicker stub exposes a button that reports a fixed coordinate, so a
// test can still exercise "customer dropped a pin".
vi.mock('../components/DeliveryRouteMap.jsx', () => ({
  default: () => createElement('div', { 'data-testid': 'route-map' }, 'route map'),
}))
vi.mock('../components/LocationPicker.jsx', () => ({
  default: ({ onChange, onAddress, lat, lng }) =>
    createElement('button', {
      type: 'button',
      'data-lat': lat ?? '',
      'data-lng': lng ?? '',
      onClick: () => { onChange(6.7, -1.62); if (onAddress) onAddress('KNUST Ave, Kumasi'); },
    }, 'drop-pin'),
}))

// The scout's check-in map (Leaflet) is stubbed the same way.
vi.mock('../components/admin/panels/VisitMap.jsx', () => ({
  default: ({ label }) => createElement('div', { 'data-testid': 'visit-map', role: 'img', 'aria-label': label }, 'visit map'),
}))

// The Operations team Visit map (several Leaflet markers) is stubbed too.
vi.mock('../components/admin/panels/TeamVisitMap.jsx', () => ({
  default: ({ label, points, onSelect }) =>
    createElement('div', { 'data-testid': 'team-visit-map', role: 'img', 'aria-label': label },
      points.map((p) => createElement('button', { key: p.id, type: 'button', 'data-state': p.state, onClick: () => onSelect?.(p.id) }, `pin ${p.label}`))),
}))

// The Delivery Manager's rider map (Leaflet) is stubbed the same way.
vi.mock('../components/admin/panels/delivery/RiderMap.jsx', () => ({
  default: ({ label, points, onSelect }) =>
    createElement('div', { 'data-testid': 'rider-map', role: 'img', 'aria-label': label },
      points.map((p) => createElement('button', { key: p.id, type: 'button', 'data-state': p.state, onClick: () => onSelect?.(p.id) }, `pin ${p.label}`))),
}))

// The shared delivery TrackMap (Leaflet) is stubbed the same way; data-route-points lets tests
// assert the road route was passed through.
vi.mock('../components/maps/TrackMap.jsx', () => ({
  default: ({ label, markers = [], route, onSelect }) =>
    createElement('div', { 'data-testid': 'track-map', role: 'img', 'aria-label': label, 'data-route-points': route ? route.length : 0 },
      markers.map((m) => createElement('button', { key: m.id, type: 'button', 'data-kind': m.kind, onClick: () => onSelect?.(m.id) }, `pin ${m.label}`))),
}))

// The zone drawing map (Leaflet + Leaflet Draw) is stubbed: one button draws a fixed triangle
// (an open [lng, lat] ring, as the backend stores it), one clears the shape.
vi.mock('../components/maps/ZoneDrawMap.jsx', () => ({
  default: ({ onChange, others = [] }) =>
    createElement('div', { 'data-testid': 'zone-draw-map', 'data-others': others.length },
      createElement('button', { type: 'button', onClick: () => onChange?.([[-1.62, 6.69], [-1.60, 6.69], [-1.61, 6.71]]) }, 'draw triangle'),
      createElement('button', { type: 'button', onClick: () => onChange?.(null) }, 'clear shape')),
}))

// jsdom does not implement matchMedia; stub it so hooks like useTheme (which
// checks `prefers-color-scheme: dark` when no theme is stored) don't throw
// when rendered under test. Individual tests can still override
// window.matchMedia to exercise specific media-query outcomes.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
}

// jsdom does not implement ResizeObserver; recharts' <ResponsiveContainer>
// (used by the Business Command Center's analytics charts) needs it or it
// throws on mount. Provide a no-op stub so charts render under test. Charts are
// also given explicit width/height in tests (ResponsiveContainer reports 0×0 in
// jsdom regardless), so this only needs to exist, not measure anything.
if (typeof globalThis !== 'undefined' && !globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
// The network-status store is module-global: a test whose request fails with
// HttpResponse.error() would otherwise leave every later test in the file
// "offline" (and the staff OfflineBanner showing).
afterEach(() => {
  server.resetHandlers()
  resetNetworkStatusForTests()
})
afterAll(() => server.close())

// jsdom's window.scrollTo only logs "Not implemented". The staff shell scrolls
// to top on every panel change, so give it a silent no-op; tests that care
// spy on it with vi.spyOn(window, 'scrollTo').
if (typeof window !== 'undefined') {
  window.scrollTo = () => {}
}
