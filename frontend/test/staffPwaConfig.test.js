import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (p) => readFileSync(path.join(root, p), 'utf8')

describe('staff PWA manifest', () => {
  const manifest = JSON.parse(read('public/staff.webmanifest'))

  it('is scoped to /staff and opens there', () => {
    expect(manifest).toMatchObject({ id: '/staff', start_url: '/staff', scope: '/staff', display: 'standalone', name: 'AshantiHub Staff' })
  })

  it('ships 192/512 "any" PNGs and a maskable 512 that exist on disk', () => {
    const bySize = (size, purpose) => manifest.icons.find((i) => i.sizes === size && i.purpose === purpose)
    for (const icon of [bySize('192x192', 'any'), bySize('512x512', 'any'), bySize('512x512', 'maskable')]) {
      expect(icon?.type).toBe('image/png')
      expect(existsSync(path.join(root, 'public', icon.src))).toBe(true)
    }
  })

  it('only offers shortcuts into staff panels', () => {
    expect(manifest.shortcuts.map((s) => s.url)).toEqual(['/staff/kyc', '/staff/messaging', '/staff/moderation'])
  })
})

describe('index.html', () => {
  const html = read('index.html')
  it('does not link a manifest globally (the staff one is injected on /staff only)', () => {
    expect(html).not.toMatch(/rel="manifest"/)
  })
  it('does not extend public pages under notches (viewport-fit=cover is added on /staff only)', () => {
    expect(html).not.toMatch(/viewport-fit=cover/)
  })
})

describe('dead pre-PWA files', () => {
  it('are gone from the frontend root', () => {
    expect(existsSync(path.join(root, 'manifest.json'))).toBe(false)
    expect(existsSync(path.join(root, 'sw.js'))).toBe(false)
  })
})

describe('hosting headers for the staff PWA', () => {
  const vercel = JSON.parse(read('vercel.json'))
  const headerFor = (source, key) =>
    vercel.headers.find((h) => h.source === source)?.headers.find((x) => x.key === key)?.value

  it('vercel: the service worker and manifest always revalidate', () => {
    expect(headerFor('/sw.js', 'Cache-Control')).toBe('no-cache, must-revalidate')
    expect(headerFor('/staff.webmanifest', 'Cache-Control')).toBe('no-cache, must-revalidate')
    expect(headerFor('/staff.webmanifest', 'Content-Type')).toBe('application/manifest+json')
  })

  it.each(['ashantihub-spa.tpl', 'ashantihub-spa.stpl'])('nginx %s: no-cache sw.js + typed manifest, never a ^~ .well-known location', (file) => {
    const conf = readFileSync(path.join(root, '..', 'infra', 'hestia', 'templates', file), 'utf8')
    expect(conf).toMatch(/location = \/sw\.js \{[^}]*no-cache, must-revalidate/s)
    expect(conf).toMatch(/location = \/staff\.webmanifest \{[^}]*application\/manifest\+json[^}]*no-cache, must-revalidate/s)
    expect(conf).not.toMatch(/\^~\s*\/\.well-known/)
  })
})

describe('index.css iOS zoom guard', () => {
  const css = read('index.css')
  it('forces 16px on form controls for touch devices, outside any @layer', () => {
    const m = css.match(/@media \(hover: none\) and \(pointer: coarse\) \{([^}]*)\}/)
    expect(m).not.toBeNull()
    expect(m[1]).toMatch(/select,/)
    expect(m[1]).toMatch(/textarea \{ font-size: 16px !important; /)
    expect(m[1]).toMatch(/input:not\(\[type="checkbox"\]\)/)
    // top-level: the text before the rule must have balanced braces
    const before = css.slice(0, css.indexOf(m[0]))
    expect((before.match(/\{/g) || []).length).toBe((before.match(/\}/g) || []).length)
  })
  it('does not lock viewport zoom', () => {
    expect(read('index.html')).not.toMatch(/maximum-scale|user-scalable/)
  })
})
