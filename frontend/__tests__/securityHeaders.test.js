// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const stpl = readFileSync(resolve(root, '../infra/hestia/templates/ashantihub-spa.stpl'), 'utf8')
const html = readFileSync(resolve(root, 'index.html'), 'utf8')
const vercel = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'))

const headerLines = stpl.split('\n').map((l) => l.trim()).filter((l) => /^add_header (X-Content-Type|X-Frame|Referrer|Permissions|Content-Security)/.test(l))
const csp = (headerLines.find((l) => l.startsWith('add_header Content-Security-Policy-Report-Only')) || '').match(/"(.*)"/)?.[1]

describe('security headers (FE-03)', () => {
  it('repeats the same header block in the server and in every location that sets its own add_header', () => {
    // server level + / + /assets/ + /index.html + /sw.js + /staff.webmanifest = 6 copies of 5 headers
    expect(headerLines.length).toBe(30)
    expect(new Set(headerLines).size).toBe(5)
  })

  it('never adds a ^~ /.well-known/ location (breaks Let\'s Encrypt issuance and renewal)', () => {
    expect(stpl).not.toMatch(/location\s+\^~\s+\/\.well-known/)
  })

  it('allows exactly the inline theme script in index.html by hash', () => {
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
    expect(inline).toHaveLength(1)
    const hash = `sha256-${createHash('sha256').update(inline[0]).digest('base64')}`
    expect(csp).toContain(`'${hash}'`)
  })

  it('forbids framing, plugins and unsafe script sources', () => {
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/)
  })

  it('serves the same CSP from vercel.json as from the Hestia template', () => {
    const vercelCsp = vercel.headers[0].headers.find((h) => h.key === 'Content-Security-Policy-Report-Only')?.value
    expect(vercelCsp).toBe(csp)
  })
})
