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

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
