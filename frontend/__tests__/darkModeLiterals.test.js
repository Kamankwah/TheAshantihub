import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Dark mode is CSS variables read through C's theme tokens and `D`
// (theme.js / components/dashboard/theme.js). A hardcoded white or cream
// surface stays light when the theme is dark, so source code outside the
// theme files must not set one. Fixed white is allowed only where it is the
// point (QR codes must be dark-on-white for scanners); those few places use
// C.paper and are listed below with the reason.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const THEME_FILES = new Set(['theme.js', 'components/dashboard/theme.js', 'components/admin/theme.js'])
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dev-dist', 'mocks', 'test', 'scripts', 'public', '__tests__', 'coverage'])

// file → reason. Matches by path; each entry must still need its exemption.
const ALLOWLIST = {
  'components/TicketQr.jsx': 'QR code: scanners need dark modules on a white quiet zone (C.paper)',
  'components/admin/TwoFactorSetup.jsx': 'authenticator QR code: dark-on-white for phone cameras (C.paper)',
}

function sourceFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) {
      if (!SKIP_DIRS.has(name) && !name.startsWith('.')) out.push(...sourceFiles(abs))
    } else if (/\.(jsx?|tsx?)$/.test(name) && !/\.test\.|\.d\.ts$|\.config\./.test(name)) {
      out.push(relative(root, abs).split('\\').join('/'))
    }
  }
  return out
}

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
function isLightSurfaceHex(raw) {
  let h = raw.toLowerCase()
  if (h.length === 4) h = '#' + [...h.slice(1)].map((c) => c + c).join('')
  const c = rgb(h)
  return Math.min(...c) >= 0xe6 // white, cream, near-white greys and pastels
}

// A light surface in a background value: white, #fff/#ffffff, cream/near-white
// hex, a mostly-opaque white rgba, or the fixed C.white / C.cream / C.paper.
function bannedIn(value) {
  const hits = []
  for (const m of value.matchAll(/["'`][^"'`]*["'`]|C\.(white|cream|paper)\b/g)) {
    const lit = m[0]
    if (lit.startsWith('C.')) { hits.push(lit); continue }
    if (/\bwhite\b/i.test(lit)) hits.push(lit)
    for (const h of lit.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)) if (isLightSurfaceHex(h[0])) hits.push(lit)
    for (const r of lit.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/g)) {
      const [R, G, B, A = 1] = [+r[1], +r[2], +r[3], r[4] === undefined ? 1 : +r[4]]
      if (Math.min(R, G, B) >= 230 && A >= 0.5) hits.push(lit)
    }
  }
  return hits
}

function offenders(file) {
  const code = readFileSync(join(root, file), 'utf8')
  const out = []
  code.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\bbackground(?:Color)?\s*:\s*([^,}]+(?:\?[^,}]+)?)/g)) {
      for (const hit of bannedIn(m[1])) out.push(`${file}:${i + 1} background ${hit}`)
    }
  })
  return out
}

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
      expect(readFileSync(join(root, file), 'utf8'), file).toMatch(/C\.paper/)
    }
  })

  it('the scanner catches the light literals it is meant to', () => {
    expect(bannedIn('"white"')).toHaveLength(1)
    expect(bannedIn('"#fff"')).toHaveLength(1)
    expect(bannedIn('C.cream')).toHaveLength(1)
    expect(bannedIn('C.paper')).toHaveLength(1)
    expect(bannedIn('active ? C.gold : "#f0f0f0"')).toHaveLength(1)
    expect(bannedIn('"rgba(255,255,255,0.9)"')).toHaveLength(1)
    expect(bannedIn('C.surface')).toHaveLength(0)
    expect(bannedIn('"rgba(255,255,255,0.08)"')).toHaveLength(0)
    expect(bannedIn(`\`linear-gradient(135deg,\${C.darkBrown},\${C.black})\``)).toHaveLength(0)
  })
})
