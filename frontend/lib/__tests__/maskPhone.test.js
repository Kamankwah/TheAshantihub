import { describe, expect, it } from 'vitest'
import { maskPhone } from '../maskPhone.js'

describe('maskPhone', () => {
  it('masks local and international forms the same way', () => {
    expect(maskPhone('0241234118')).toBe('024 *** 118')
    expect(maskPhone('+233241234118')).toBe('024 *** 118')
    expect(maskPhone('233 24 123 4118')).toBe('024 *** 118')
  })
  it('leaves what it cannot read, and empty input, alone', () => {
    expect(maskPhone('')).toBe('')
    expect(maskPhone(null)).toBe('')
    expect(maskPhone('12345')).toBe('12345')
  })
})
