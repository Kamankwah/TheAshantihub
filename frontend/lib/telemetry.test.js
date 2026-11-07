import { describe, it, expect } from 'vitest'
import { scrub, scrubText, stripUrl, telemetryEnabled, reportError, initTelemetry } from './telemetry.js'

describe('telemetry scrubbing', () => {
  it('redacts e-mails, Ghana phone numbers and long tokens from text', () => {
    expect(scrubText('mail ama@example.com or 0244123456 or +233244123456')).toBe('mail [email] or [phone] or [phone]')
    expect(scrubText('Bearer abcdefghijklmnopqrstuvwxyz012345')).toBe('[token]')
    expect(scrubText('plain message')).toBe('plain message')
  })
  it('drops query strings and fragments from URLs', () => {
    expect(stripUrl('https://x.com/a/b?token=1#frag')).toBe('https://x.com/a/b')
    expect(stripUrl('https://x.com/a')).toBe('https://x.com/a')
  })
  it('removes user, cookies, headers and bodies from an event', () => {
    const event = scrub({
      user: { id: 7, email: 'a@b.co' },
      request: { url: 'https://x.com/p?reset=abc', headers: { cookie: 'c' }, cookies: { s: '1' }, data: 'body' },
      message: 'failed for a@b.co',
      exception: { values: [{ value: 'phone 0244123456' }] },
      breadcrumbs: [{ message: 'to a@b.co', data: { url: 'https://x.com/q?x=1', body: 'secret' } }],
    })
    expect(event.user).toBeUndefined()
    expect(event.request).toEqual({ url: 'https://x.com/p' })
    expect(event.message).toBe('failed for [email]')
    expect(event.exception.values[0].value).toBe('phone [phone]')
    expect(event.breadcrumbs[0].data).toEqual({ url: 'https://x.com/q' })
    expect(event.breadcrumbs[0].message).toBe('to [email]')
  })
})

describe('telemetry without a DSN', () => {
  it('is disabled and every entry point is a harmless no-op', async () => {
    expect(telemetryEnabled()).toBe(false)
    await expect(initTelemetry()).resolves.toBeUndefined()
    expect(() => reportError(new Error('x'), { componentStack: 'at X' })).not.toThrow()
  })
})
