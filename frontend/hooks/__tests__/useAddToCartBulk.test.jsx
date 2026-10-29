import { describe, expect, test } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../mocks/server.js'
import { bulkErrorMessage, useAddToCartBulk } from '../useAddToCartBulk.js'

const API = 'http://localhost:8000'
const wrap = (client) => ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>

describe('useAddToCartBulk', () => {
  test('test_a_successful_add_invalidates_the_cart_the_guard_and_the_browse_lists', async () => {
    server.use(http.post(`${API}/api/cart/items/`, () => HttpResponse.json({}, { status: 201 })))
    const client = new QueryClient()
    const keys = []
    const original = client.invalidateQueries.bind(client)
    client.invalidateQueries = (arg) => { keys.push(arg.queryKey[0]); return original(arg) }
    const { result } = renderHook(() => useAddToCartBulk(), { wrapper: wrap(client) })
    let ok
    await act(async () => { ok = await result.current.add(12, {}) })
    expect(ok).toBe(true)
    expect(keys).toEqual(expect.arrayContaining(['cart', 'cart-guard', 'listings']))
  })

  test('test_body_level_and_per_line_errors_are_both_read', () => {
    expect(bulkErrorMessage({ body: { detail: 'This listing is no longer available.' }, message: 'x' })).toBe('This listing is no longer available.')
    expect(bulkErrorMessage({ body: { lines: [{ index: 0, detail: 'Only 2 left.' }, { index: 1, detail: 'Sold out.' }] } })).toBe('Only 2 left. Sold out.')
  })
})
