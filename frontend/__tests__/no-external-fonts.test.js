import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname, resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const SKIP = new Set(['node_modules', 'dist', '__tests__', 'coverage', 'public', '.git'])
const EXT = new Set(['.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.json', '.mjs'])
const HOSTS = /fonts\.googleapis\.com|fonts\.gstatic\.com/

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name === 'package-lock.json') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (EXT.has(extname(p))) out.push(p)
  }
  return out
}

describe('self-hosted fonts', () => {
  it('no source references an external font host', () => {
    const offenders = walk(ROOT).filter((f) => HOSTS.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('imports the bundled font packages', () => {
    const css = readFileSync(join(ROOT, 'index.css'), 'utf8')
    expect(css).toMatch(/@fontsource-variable\/fraunces/)
    expect(css).toMatch(/@fontsource-variable\/plus-jakarta-sans/)
    expect(css).toMatch(/@fontsource\/jetbrains-mono/)
    expect(css).toMatch(/tabular-nums/)
  })

  it('never names the variable families without their Variable suffix', () => {
    // @fontsource-variable registers 'Fraunces Variable' / 'Plus Jakarta Sans Variable';
    // a bare name silently falls through to the fallback font.
    const bare = /(?<!\w)['"]?(Fraunces|Plus Jakarta Sans)(?! Variable)['"]?\s*,/
    const offenders = walk(ROOT).filter((f) => {
      if (!/\.(jsx?|tsx?|css)$/.test(f)) return false
      return readFileSync(f, 'utf8').split('\n').some((l) => {
        if (/^\s*(\/\/|\/?\*)/.test(l) || !/font/i.test(l)) return false
        const m = l.match(bare)
        if (!m) return false
        // allowed when the bare name is the documented fallback after the Variable one
        return !new RegExp(`${m[1]} Variable['"]?\\s*,\\s*['"]?${m[1]}`).test(l)
      })
    })
    expect(offenders).toEqual([])
  })
})
