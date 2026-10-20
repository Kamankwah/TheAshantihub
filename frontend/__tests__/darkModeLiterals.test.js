import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Dark mode is CSS variables read through C's theme tokens and `D`
// (theme.js / components/dashboard/theme.js). A hardcoded light surface stays
// light when the theme is dark, and a hardcoded dark ink disappears on a dark
// surface, so source code outside the theme files must not set either. Fixed
// white is allowed only where it is the point (QR codes must be dark-on-white
// for scanners); those places use C.paper and are listed below with the reason.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const THEME_FILES = new Set(['theme.js', 'components/dashboard/theme.js', 'components/admin/theme.js', 'index.css'])
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dev-dist', 'mocks', 'test', 'scripts', 'public', '__tests__', 'coverage'])

// file → reason. Matches by path; each entry must still need its exemption.
const ALLOWLIST = {
  'components/TicketQr.jsx': 'QR code: scanners need dark modules on a white quiet zone (C.paper)',
  'components/admin/TwoFactorSetup.jsx': 'authenticator QR code: dark-on-white for phone cameras (C.paper)',
}

// Leaflet marker/path option objects (map overlays on light map tiles) keep
// fixed colours; a value inside such an object is not a page surface or ink.
const MAP_OPTIONS = /\b(fillColor|fillOpacity|weight|dashArray)\s*:/

function sourceFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) {
      if (!SKIP_DIRS.has(name) && !name.startsWith('.')) out.push(...sourceFiles(abs))
    } else if (/\.(jsx?|tsx?|css)$/.test(name) && !/\.test\.|\.d\.ts$|\.config\./.test(name)) {
      out.push(relative(root, abs).split('\\').join('/'))
    }
  }
  return out
}

// ── colour helpers ───────────────────────────────────────────────────────────
function hexRgb(raw) {
  let h = raw.toLowerCase().slice(1)
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}
function luminance([r, g, b]) {
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
const DARK_SURFACE = luminance(hexRgb('#2C1810')) // C.surface in dark mode

// light enough to be a page/card surface: white, cream (#FDF6E3), the cream
// wells (#F5ECD8, #EADFC6), near-white greys and pastels
const isLightSurface = (rgb) => luminance(rgb) >= 0.7

// A light surface in a background value: white, a light hex, an opaque light
// rgba (also inside gradients), or the fixed C.white / C.cream / C.paper.
function bannedIn(value) {
  const hits = []
  for (const m of value.matchAll(/C\.(white|cream|paper)\b/g)) hits.push(m[0])
  const literal = value.replace(/\$\{[^}]*\}/g, ' ')
  if (/(^|[^\w-])white\b/i.test(literal)) hits.push('white')
  for (const h of literal.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)) if (isLightSurface(hexRgb(h[0]))) hits.push(h[0])
  for (const r of literal.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/g)) {
    const a = r[4] === undefined ? 1 : +r[4]
    if (isLightSurface([+r[1], +r[2], +r[3]]) && a >= 0.5) hits.push(r[0])
  }
  return hits
}

// The value of a property starting at `from`: up to the first `,` `}` `;` or
// `)` at depth 0, across lines, skipping strings/templates/brackets.
function valueAt(code, from) {
  let depth = 0
  let i = from
  for (; i < code.length; i++) {
    const ch = code[i]
    if (ch === '"' || ch === "'") {
      const end = code.indexOf(ch, i + 1)
      i = end < 0 ? code.length : end
    } else if (ch === '`') {
      for (i++; i < code.length && code[i] !== '`'; i++) {
        if (code[i] === '\\') i++
        else if (code[i] === '$' && code[i + 1] === '{') {
          let d = 0
          for (; i < code.length; i++) { if (code[i] === '{') d++; else if (code[i] === '}' && --d === 0) break }
        }
      }
    } else if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) { if (depth === 0) break; depth-- }
    else if ((ch === ',' || ch === ';') && depth === 0) break
  }
  return code.slice(from, i)
}

const lineOf = (code, index) => code.slice(0, index).split('\n').length

// Index of the bracket closing the one at `open`, skipping strings/templates.
function closeOf(code, open) {
  let depth = 0
  for (let i = open; i < code.length; i++) {
    const ch = code[i]
    if (ch === '"' || ch === "'") { const end = code.indexOf(ch, i + 1); i = end < 0 ? code.length : end }
    else if (ch === '`') {
      for (i++; i < code.length && code[i] !== '`'; i++) {
        if (code[i] === '\\') i++
        else if (code[i] === '$' && code[i + 1] === '{') i = closeOf(code, i + 1)
      }
    } else if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch) && --depth === 0) return i
  }
  return code.length
}

// The object literal text around `index` (for map-option and fill context):
// the nearest `{` before it whose match closes after it.
function enclosingObject(code, index) {
  for (let open = code.lastIndexOf('{', index); open >= 0; open = code.lastIndexOf('{', open - 1)) {
    const close = closeOf(code, open)
    if (close > index) return code.slice(open, close + 1)
  }
  return ''
}

const THEMED_FILL = /^\s*(C\.(canvas|surface\w*|okBg|errBg|warnBg)|D\.(pageBg|panelBg\w*|panelSolid|okBg|errBg|warnBg)|tint\((C|D)\.\w+, ?"[0-7])/

// A fixed colour that is right in both themes (e.g. white slide dots drawn
// over a photo) carries `// dark-mode-ok: <why>` on its line or the line
// above; the reason is required.
const OK_NOTE = /dark-mode-ok:\s*\S.{9,}/

export function offendersIn(code, file = 'inline') {
  const out = []
  const lines = code.split('\n')
  const push = (index, what) => {
    const n = lineOf(code, index)
    if (OK_NOTE.test(lines[n - 1]) || OK_NOTE.test(lines[n - 2] || '')) return
    out.push(`${file}:${n} ${what}`)
  }

  // 1. background values (object syntax, JSX, CSS in templates or .css files)
  for (const m of code.matchAll(/(?<![\w$-])(background(?:Color|Image|-color|-image)?|bg)\s*:\s*/g)) {
    const start = m.index + m[0].length
    if (MAP_OPTIONS.test(enclosingObject(code, m.index))) continue
    for (const hit of bannedIn(valueAt(code, start))) push(m.index, `${m[1]} ${hit}`)
  }
  // 2. imperative style writes: el.style.background = "#fafafa"
  for (const m of code.matchAll(/\.style\.(background(?:Color)?|color)\s*=\s*/g)) {
    const value = valueAt(code, m.index + m[0].length).split('\n')[0]
    if (m[1] !== 'color') {
      for (const hit of bannedIn(value)) push(m.index, `style.${m[1]} = ${hit}`)
    } else if (/["'`]#[0-9a-f]{3,6}\b|["'`](black|white)["'`]/i.test(value)) {
      push(m.index, `style.color = ${value.trim()}`)
    }
  }
  // 3. style-helper arguments: smallBtn("#fff", D.text), button(C.white, …)
  for (const m of code.matchAll(/\b(\w*(?:[bB]tn|[bB]utton|[cC]hip|[pP]ill|[cC]allout|[bB]adge|[tT]ag))\(([^()]*)\)/g)) {
    const first = m[2].split(',')[0]
    for (const hit of bannedIn(first)) push(m.index, `${m[1]}(${hit}, …)`)
  }
  // 4. hardcoded dark/saturated ink: a literal text colour that would sit
  //    under 3:1 on the dark-mode surface, unless its own object paints a
  //    fixed (non-theme) fill behind it.
  for (const m of code.matchAll(/(?<![\w$-])color\s*:\s*/g)) {
    const value = valueAt(code, m.index + m[0].length)
    const obj = enclosingObject(code, m.index)
    if (MAP_OPTIONS.test(obj)) continue
    const bg = /(?<![\w$-])background(?:Color)?\s*:\s*/.exec(obj)
    if (bg && !THEMED_FILL.test(obj.slice(bg.index + bg[0].length))) continue
    for (const h of value.matchAll(/["'`](#[0-9a-f]{6}|#[0-9a-f]{3})\b/gi)) {
      if (contrast(luminance(hexRgb(h[1])), DARK_SURFACE) < 3) push(m.index, `ink ${h[1]}`)
    }
  }
  return out
}

const offenders = (file) => offendersIn(readFileSync(join(root, file), 'utf8'), file)

describe('dark mode source scan', () => {
  const files = sourceFiles(root).filter((f) => !THEME_FILES.has(f))

  it('scans the whole app', () => {
    expect(files).toContain('App.jsx')
    expect(files).toContain('components/CartDrawer.jsx')
    expect(files.length).toBeGreaterThan(300)
  })

  it('no component hardcodes a page background colour outside theme files (allowlist for brand marks and kente stripes)', () => {
    const found = files.filter((f) => !ALLOWLIST[f]).flatMap(offenders)
    expect(found).toEqual([])
  })

  it('every allowlist entry is still needed and gives a reason', () => {
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length, file).toBeGreaterThan(20)
      expect(offenders(file).length, file).toBeGreaterThan(0)
      expect(offenders(file).every((o) => /C\.paper/.test(o)), file).toBe(true)
    }
  })

  it('the scanner catches the light literals it is meant to', () => {
    const n = (code) => offendersIn(code).length
    expect(n('style={{ background: "white" }}')).toBe(1)
    expect(n('style={{ background: "#fff" }}')).toBe(1)
    expect(n('style={{ background: C.cream }}')).toBe(1)
    expect(n('style={{ background: C.paper }}')).toBe(1)
    expect(n('style={{ background: active ? C.gold : "#f0f0f0" }}')).toBe(1)
    expect(n('style={{ background: "rgba(255,255,255,0.9)" }}')).toBe(1)
    expect(n('style={{ background: "rgba(255, 255, 255, 0.95)" }}')).toBe(1)
    expect(n('style={{ background: "rgba(253,246,227,0.9)" }}')).toBe(1)
    expect(n('style={{ background: "#F5ECD8" }}')).toBe(1)
    expect(n('style={{ background: "#EADFC6" }}')).toBe(1)
    expect(n('style={{ background: "#E3F1E3" }}')).toBe(1)
    expect(n('style={{ background: "linear-gradient(135deg, #fff, #FDF6E3)" }}')).toBe(2)
    expect(n('style={{ backgroundImage: "linear-gradient(#fff,#fff)" }}')).toBe(2)
    expect(n('const s = { bg: "#fff" }')).toBe(1)
    expect(n('style={{ background:\n "#fff" }}')).toBe(1)
    expect(n('.x:hover { background: #fff; }')).toBe(1)
    expect(n('el.style.background = "#fafafa"')).toBe(1)
    expect(n('el.style.background = "white"')).toBe(1)
    expect(n('style={smallBtn("#fff", D.text)}')).toBe(1)
    expect(n('style={{ color: "#1e40af", background: C.surface2 }}')).toBe(1)
    expect(n('style={{ color: "#00500A" }}')).toBe(1)
    // fine: tokens, translucent white on a dark bar, dark gradients, fixed fills, map overlays
    expect(n('style={{ background: C.surface, color: C.ink }}')).toBe(0)
    expect(n('style={{ background: "rgba(255,255,255,0.08)" }}')).toBe(0)
    expect(n('style={{ background: `linear-gradient(135deg,${C.darkBrown},${C.black})` }}')).toBe(0)
    expect(n('style={{ background: C.gold, color: "#1a1205" }}')).toBe(0)
    expect(n('pathOptions={{ color: "#006400", weight: 2, fillColor: "#FFFFFF" }}')).toBe(0)
    expect(n('el.style.background = C.surface2')).toBe(0)
    expect(n('// dark-mode-ok: white dots drawn over the slide photo\nstyle={{ background: "rgba(255,255,255,0.5)" }}')).toBe(0)
    expect(n('// dark-mode-ok:\nstyle={{ background: "#fff" }}')).toBe(1)
  })
})
