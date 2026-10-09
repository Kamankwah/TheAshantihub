import '@testing-library/jest-dom'
import { createElement } from 'react'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { server } from '../mocks/server.js'
import { resetNetworkStatusForTests } from '../lib/networkStatus.js'

// Leaflet needs a real browser (sized DOM, canvas) and doesn't render under
// jsdom, so the two map components (item 11) are stubbed for every test. Their
// real behaviour is verified manually in the browser, not here. The
// LocationPicker stub exposes a button that reports a fixed coordinate, so a
// test can still exercise "customer dropped a pin".
vi.mock('../components/DeliveryRouteMap.jsx', () => ({
  default: () => createElement('div', { 'data-testid': 'route-map' }, 'route map'),
}))
vi.mock('../components/LocationPicker.jsx', () => ({
  default: ({ onChange, onAddress }) =>
    createElement('button', {
      type: 'button',
      onClick: () => { onChange(6.7, -1.62); if (onAddress) onAddress('KNUST Ave, Kumasi'); },
    }, 'drop-pin'),
}))

// The scout's check-in map (Leaflet) is stubbed the same way.
vi.mock('../components/admin/panels/VisitMap.jsx', () => ({
  default: ({ label }) => createElement('div', { 'data-testid': 'visit-map', role: 'img', 'aria-label': label }, 'visit map'),
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
