import '@testing-library/jest-dom'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from '../mocks/server.js'

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
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
