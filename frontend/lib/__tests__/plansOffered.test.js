import { describe, expect, it } from 'vitest'
import { noPlansOffered } from '../plansOffered.js'

describe('noPlansOffered', () => {
  it('only an answered empty list means none offered', () => {
    expect(noPlansOffered({ data: [] })).toBe(true)
    expect(noPlansOffered({ data: [{ id: 1 }] })).toBe(false)
    expect(noPlansOffered({ data: undefined, isLoading: true })).toBe(false)
    expect(noPlansOffered({ data: undefined, isError: true })).toBe(false)
    expect(noPlansOffered({ data: null })).toBe(false)
    expect(noPlansOffered({ data: {} })).toBe(false)
    expect(noPlansOffered(undefined)).toBe(false)
    expect(noPlansOffered(null)).toBe(false)
  })
})
