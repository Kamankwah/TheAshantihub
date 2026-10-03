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
  it('lets the staff shell extend under notches', () => {
    expect(html).toMatch(/viewport-fit=cover/)
  })
})

describe('dead pre-PWA files', () => {
  it('are gone from the frontend root', () => {
    expect(existsSync(path.join(root, 'manifest.json'))).toBe(false)
    expect(existsSync(path.join(root, 'sw.js'))).toBe(false)
  })
})
