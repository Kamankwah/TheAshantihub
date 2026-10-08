import { describe, expect, it } from 'vitest'
import { describeWait, formatDuration, timeAgo } from '../timeAgo.js'

const MIN = 60000
const HOUR = 60 * MIN
const now = Date.parse('2026-10-08T12:00:00Z')
const at = (ms) => new Date(now + ms).toISOString()

describe('timeAgo helpers', () => {
  it('formats under a minute, minutes, hours and days', () => {
    expect(formatDuration(10000)).toBe('under a minute')
    expect(formatDuration(40 * MIN)).toBe('40 min')
    expect(formatDuration(5 * HOUR)).toBe('5 h')
    expect(formatDuration(72 * HOUR)).toBe('3 d')
  })

  it('describes a wait and an overdue request', () => {
    expect(describeWait(at(19 * HOUR), now)).toBe('moves on in 19 h')
    expect(describeWait(at(-3 * HOUR), now)).toBe('overdue by 3 h')
    expect(describeWait(at(-10000), now)).toBe('overdue just now')
  })

  it('returns an empty string for an invalid or missing date, never NaN', () => {
    expect(timeAgo(null, now)).toBe('')
    expect(timeAgo('not a date', now)).toBe('')
    expect(describeWait(undefined, now)).toBe('')
    expect(describeWait('garbage', now)).toBe('')
  })
})
