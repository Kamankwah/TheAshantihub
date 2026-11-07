import { describe, it, expect } from 'vitest'
import { createQueryClient, shouldRetry } from './queryClient.js'

describe('shouldRetry', () => {
  it.each([400, 401, 403, 404, 422, 429])('does not retry a %i', (status) => {
    expect(shouldRetry(0, { status })).toBe(false)
  })
  it('retries a 5xx or a network error twice, then stops', () => {
    expect(shouldRetry(0, { status: 503 })).toBe(true)
    expect(shouldRetry(1, new TypeError('Failed to fetch'))).toBe(true)
    expect(shouldRetry(2, { status: 503 })).toBe(false)
  })
})

describe('createQueryClient', () => {
  it('sets the shared defaults', () => {
    const d = createQueryClient().getDefaultOptions()
    expect(d.queries.staleTime).toBe(30_000)
    expect(d.mutations.retry).toBe(false)
  })
})
