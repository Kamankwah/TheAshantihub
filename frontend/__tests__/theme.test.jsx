import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { C, THEME_TOKENS, tint } from '../theme.js'
import { CHART, D } from '../components/dashboard/theme.js'

// The light/dark palette is CSS custom properties on :root / :root[data-theme="dark"]
// (index.css), read by inline styles through C's theme tokens and `D`. jsdom
// does not load index.css, so these tests resolve a token the way the browser
// would: parse the two declaration blocks out of index.css and look the
// variable up for the given theme.

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../index.css'), 'utf8')

function declarations(selectorStart) {
  const at = css.indexOf(selectorStart)
  if (at < 0) throw new Error(`index.css has no block starting ${selectorStart}`)
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
  const out = {}
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

const CSS_TOKENS = {
  light: declarations(':root,\n[data-theme="light"]'),
  dark: declarations(':root[data-theme="dark"],\n[data-theme="dark"]'),
}

// var(--name, fallback) → the value the browser uses under `theme`.
function resolveFor(value, theme) {
  const m = /^var\(--([\w-]+),\s*(.+)\)$/.exec(value)
  if (!m) return value
  return CSS_TOKENS[theme][m[1]] ?? m[2]
}

const SEMANTIC_C = ['canvas', 'surface', 'surface2', 'surface3', 'ink', 'inkDim', 'inkFaint', 'line', 'border',
  'borderStrong', 'shadow', 'price', 'trust', 'danger', 'info', 'okBg', 'okInk', 'errBg', 'errInk', 'warnBg', 'warnInk']

describe('theme tokens', () => {
  it('C and D resolve to dark values when the theme is dark and light otherwise', () => {
    expect(resolveFor(C.canvas, 'light')).toBe('#FDF6E3')
    expect(resolveFor(C.canvas, 'dark')).toBe('#160E08')
    expect(resolveFor(C.surface, 'light')).toBe('#FFFFFF')
    expect(resolveFor(C.surface, 'dark')).toBe('#2C1810')
    expect(resolveFor(C.ink, 'light')).toBe('#2C1810')
    expect(resolveFor(C.ink, 'dark')).toBe('#F5DEB3')

    expect(resolveFor(D.pageBg, 'light')).toBe(C.cream)
    expect(resolveFor(D.pageBg, 'dark')).toBe(C.void)
    expect(resolveFor(D.panelBg, 'light')).toBe('#FFFFFF')
    expect(resolveFor(D.panelBg, 'dark')).toBe(C.darkBrown)
    expect(resolveFor(D.text, 'light')).toBe(C.darkBrown)
    expect(resolveFor(D.text, 'dark')).toBe(C.lightGold)
    expect(resolveFor(D.textDim, 'dark')).toMatch(/^rgba\(245, 222, 179/)

    for (const key of SEMANTIC_C) {
      expect(C[key], key).toMatch(/^var\(--ah-[\w-]+, .+\)$/)
      expect(resolveFor(C[key], 'light'), key).not.toBe(resolveFor(C[key], 'dark'))
    }
  })

  it('prices on dark surfaces use C.lightGold; prices on light stay dark brown', () => {
    expect(resolveFor(C.price, 'dark')).toBe(C.lightGold)
    expect(resolveFor(C.price, 'light')).toBe(C.darkBrown)
    expect(D.price).toBe(C.price)
  })

  it('trust/verified marks stay green in both themes', () => {
    const green = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
      return g > r && g > b
    }
    expect(resolveFor(C.trust, 'light')).toBe(C.kente2)
    expect(green(resolveFor(C.trust, 'dark'))).toBe(true)
    expect(D.green).toBe(C.trust)
  })

  it('brand colours and the QR paper are fixed hex in both themes', () => {
    for (const key of ['gold', 'deepGold', 'darkBrown', 'lightGold', 'cream', 'kente1', 'kente2', 'kente3', 'ghRed', 'ghGold', 'ghGreen', 'white', 'void', 'paper']) {
      expect(C[key], key).toMatch(/^#[0-9a-f]{6}$/i)
    }
    expect(C.paper).toBe('#FFFFFF')
    expect(D.gold).toBe(C.gold)
  })

  it('index.css declares exactly the THEME_TOKENS values for both themes', () => {
    expect(CSS_TOKENS.light).toEqual(THEME_TOKENS.light)
    expect(CSS_TOKENS.dark).toEqual(THEME_TOKENS.dark)
    // every var() fallback is the light value, so an un-themed page renders light
    for (const key of SEMANTIC_C) {
      const [, name, fallback] = /^var\(--([\w-]+), (.+)\)$/.exec(C[key])
      expect(fallback, key).toBe(THEME_TOKENS.light[name])
    }
  })

  it('the business dashboard scope follows the theme tokens', () => {
    const at = css.indexOf('.command-center {')
    const block = css.slice(at, css.indexOf('}', at))
    expect(block).toContain('--background: var(--ah-canvas)')
    expect(block).toContain('--card: var(--ah-surface)')
    expect(block).toContain('color: var(--ah-ink)')
    expect(CHART.grid).toBe(D.divider)
  })

  it('tint keeps the hex-alpha form for hex and mixes theme tokens', () => {
    expect(tint('#D4A017', '22')).toBe('#D4A01722')
    expect(tint(C.trust, '33')).toBe(`color-mix(in srgb, ${C.trust} 20%, transparent)`)
  })
})
