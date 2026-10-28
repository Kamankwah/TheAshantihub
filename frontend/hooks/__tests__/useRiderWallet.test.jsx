import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useRiderWallet, useRiderWalletDays, useRiderWalletEarnings } from '../useRiderWallet.js'

const API = 'http://localhost:8000'
const BASE = `${API}/api/delivery/rider/wallet`

// No `retry` override: the hooks' own retry rule is part of what is tested.
function renderWithClient(hook) {
  const queryClient = new QueryClient()
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('rider wallet hooks', () => {
  it('returns the rider summary as sent', async () => {
    const summary = { kind: 'rider', balance: '-13.50', reserve: '1.00', commission_bp: 1050, withdrawals_today: 1 }
    server.use(http.get(`${BASE}/`, () => HttpResponse.json(summary)))
    const { result } = renderWithClient(() => useRiderWallet())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(summary)
  })

  it.each(['ledger_off', 'wallet_disabled'])('does not retry %s', async (code) => {
    let calls = 0
    server.use(http.get(`${BASE}/`, () => {
      calls += 1
      return HttpResponse.json({ detail: 'No.', code }, { status: 409 })
    }))
    const { result } = renderWithClient(() => useRiderWallet())
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error.body.code).toBe(code)
    expect(calls).toBe(1)
  })

  it('earnings follow day and page and read results', async () => {
    const seen = []
    server.use(http.get(`${BASE}/earnings/`, ({ request }) => {
      const url = new URL(request.url)
      seen.push([url.searchParams.get('day'), url.searchParams.get('page')])
      return HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 7 }] })
    }))
    const { result, rerender } = renderWithClient(({ day, page } = { day: '2026-10-20', page: 1 }) => useRiderWalletEarnings({ day, page }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.results).toEqual([{ id: 7 }])
    expect(seen).toEqual([['2026-10-20', '1']])
    rerender({ day: '2026-10-19', page: 2 })
    await waitFor(() => expect(seen).toHaveLength(2))
    expect(seen[1]).toEqual(['2026-10-19', '2'])
  })

  it('an empty day is not sent', async () => {
    let query = null
    server.use(http.get(`${BASE}/earnings/`, ({ request }) => {
      query = new URL(request.url).searchParams
      return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
    }))
    const { result } = renderWithClient(() => useRiderWalletEarnings())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(query.has('day')).toBe(false)
    expect(query.get('page')).toBe('1')
  })

  it('days are not paginated', async () => {
    const days = [{ day: '2026-10-20', deliveries: 2, gross: '20.00', commission: '2.00', net: '18.00', given_back: '0.00' }]
    server.use(http.get(`${BASE}/days/`, () => HttpResponse.json({ results: days })))
    const { result } = renderWithClient(() => useRiderWalletDays())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.results).toEqual(days)
  })
})
