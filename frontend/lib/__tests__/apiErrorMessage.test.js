import { describe, expect, it } from 'vitest'
import { apiErrorMessage } from '../apiErrorMessage.js'

describe('apiErrorMessage', () => {
  it('prefers a string detail', () => {
    expect(apiErrorMessage({ body: { detail: 'Nope.' } }, 'fb')).toBe('Nope.')
  })
  it('uses the first field error', () => {
    expect(apiErrorMessage({ body: { email: ['Already used.', 'x'] } }, 'fb')).toBe('Already used.')
    expect(apiErrorMessage({ body: { email: 'Bad.' } }, 'fb')).toBe('Bad.')
  })
  it('falls back otherwise', () => {
    expect(apiErrorMessage({ body: null }, 'fb')).toBe('fb')
    expect(apiErrorMessage(new Error('x'), 'fb')).toBe('fb')
    expect(apiErrorMessage({ body: { a: [] } }, 'fb')).toBe('fb')
  })
})
