import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { THEME_TOKENS } from '../../theme.js'
import { applyInitialTheme } from '../useTheme.js'

// No light flash: the theme must be on <html> before the first paint. The
// inline script in index.html does it while the HTML is parsed (before any
// module or stylesheet loads); main.jsx's applyInitialTheme() repeats it
// before React renders. Both follow the stored toggle, else the device.

const here = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(resolve(here, '../../index.html'), 'utf8')
const inlineScript = /<script>([\s\S]*?)<\/script>/.exec(html)[1]
const originalMatchMedia = window.matchMedia

function device(dark) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({ matches: dark && query.includes('dark'), media: query, addEventListener() {}, removeEventListener() {} }))
}
function reset() {
  delete document.documentElement.dataset.theme
  document.documentElement.classList.remove('dark')
}

afterEach(() => {
  localStorage.clear()
  window.matchMedia = originalMatchMedia
  reset()
})

describe.each([
  ['applyInitialTheme()', () => applyInitialTheme()],
  ['the index.html inline script', () => new Function(inlineScript)()],
])('%s', (_name, run) => {
  it('follows a dark device when nothing is stored', () => {
    device(true)
    run()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('follows a light device when nothing is stored', () => {
    device(false)
    run()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('a stored choice wins over the device', () => {
    device(false)
    localStorage.setItem('ashantihub.theme', 'dark')
    run()
    expect(document.documentElement.dataset.theme).toBe('dark')
    reset()
    device(true)
    localStorage.setItem('ashantihub.theme', 'light')
    run()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('ignores a junk stored value', () => {
    device(true)
    localStorage.setItem('ashantihub.theme', 'purple')
    run()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

describe('index.html first paint', () => {
  it('runs the theme script in <head>, before the app module', () => {
    expect(html.indexOf(inlineScript)).toBeLessThan(html.indexOf('</head>'))
    expect(html.indexOf(inlineScript)).toBeLessThan(html.indexOf('src="/main.jsx"'))
  })

  it('paints the dark canvas behind the page before index.css loads', () => {
    expect(html).toContain(`html[data-theme="dark"]{background:${THEME_TOKENS.dark['ah-canvas']};color-scheme:dark;}`)
  })
})
