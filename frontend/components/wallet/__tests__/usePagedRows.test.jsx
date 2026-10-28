import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { usePagedRows } from '../usePagedRows.js'

const row = (holder_id, balance) => ({ holder_id, balance })
const rowKey = (r) => r.holder_id

describe('usePagedRows rowKey and later-page restart', () => {
  it('restarts from page 1 when a kept later page is refetched different, and shows a shared row once', () => {
    const p1 = { results: [row(1, '30'), row(2, '20')], next: 'n' }
    const store = { 1: p1, 2: { results: [row(3, '10'), row(4, '5')], next: null } }
    const usePage = (p) => ({ data: store[p], error: null, isFetching: false, refetch: () => {} })
    const { result, rerender } = renderHook(() => usePagedRows(usePage, { rowKey }))

    expect(result.current.rows.map(rowKey)).toEqual([1, 2])
    act(() => result.current.loadMore())
    expect(result.current.rows.map(rowKey)).toEqual([1, 2, 3, 4])

    // Page 1 is the identical object; page 2 is refetched and now repeats holder 2.
    store[2] = { results: [row(2, '7'), row(4, '5')], next: null }
    rerender()
    expect(result.current.rows.map(rowKey)).toEqual([1, 2])
    expect(result.current.hasMore).toBe(true)

    act(() => result.current.loadMore())
    expect(result.current.rows.map(rowKey)).toEqual([1, 2, 4])
  })

  it('without rowKey, rows keep de-duplicating by id', () => {
    const store = { 1: { results: [{ id: 1 }, { id: 1 }, { id: 2 }], next: null } }
    const { result } = renderHook(() => usePagedRows((p) => ({ data: store[p], error: null, refetch: () => {} })))
    expect(result.current.rows).toHaveLength(2)
  })
})
