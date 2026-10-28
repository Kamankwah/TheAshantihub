import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useVendorBookings, useVendorDaily, useVendorFees, useVendorSales, useVendorTexts } from '../useVendorMoney.js'

const API = 'http://localhost:8000'

// No `retry` override: the hooks' own retry rule is part of what is tested.
function renderWithClient(hook, queryClient = new QueryClient()) {
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

const PAGE = { count: 0, next: null, previous: null, results: [] }

function capture(path, body) {
  const seen = []
  server.use(http.get(`${API}${path}`, ({ request }) => {
    seen.push(new URL(request.url).searchParams)
    return HttpResponse.json(body)
  }))
  return seen
}

describe('vendor money hooks', () => {
  it('test_sales_omit_all_blank_dates_and_page_one', async () => {
    const seen = capture('/api/wallet/vendor/sales/', PAGE)
    const { result } = renderWithClient(() => useVendorSales())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect([...seen[0].keys()]).toEqual([])
    expect(result.current.data.results).toEqual([])
  })

  it('test_sales_send_status_dates_and_page', async () => {
    const seen = capture('/api/wallet/vendor/sales/', PAGE)
    const { result } = renderWithClient(() => useVendorSales({ status: 'released', dateFrom: '2026-10-01', dateTo: '2026-10-20', page: 3 }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(Object.fromEntries(seen[0])).toEqual({ status: 'released', date_from: '2026-10-01', date_to: '2026-10-20', page: '3' })
  })

  it('test_bookings_use_their_own_path', async () => {
    const seen = capture('/api/wallet/vendor/bookings/', PAGE)
    const { result } = renderWithClient(() => useVendorBookings({ status: 'awaiting_call' }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(Object.fromEntries(seen[0])).toEqual({ status: 'awaiting_call' })
  })

  it('test_daily_sends_only_typed_dates', async () => {
    const seen = capture('/api/wallet/vendor/daily/', { days: [] })
    const first = renderWithClient(() => useVendorDaily())
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    const second = renderWithClient(() => useVendorDaily({ dateFrom: '2026-10-05' }))
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true))
    expect(Object.fromEntries(seen[0])).toEqual({})
    expect(Object.fromEntries(seen[1])).toEqual({ date_from: '2026-10-05' })
  })

  it('test_fees_ask_for_a_quote_only_with_an_amount', async () => {
    const seen = capture('/api/wallet/vendor/fees/', { categories: [] })
    const plain = renderWithClient(() => useVendorFees())
    await waitFor(() => expect(plain.result.current.isSuccess).toBe(true))
    const quoted = renderWithClient(() => useVendorFees({ amount: '100.00', category: 'service' }))
    await waitFor(() => expect(quoted.result.current.isSuccess).toBe(true))
    expect(Object.fromEntries(seen[0])).toEqual({})
    expect(Object.fromEntries(seen[1])).toEqual({ amount: '100.00', category: 'service' })
  })

  it('test_texts_are_a_plain_object', async () => {
    const { result } = renderWithClient(() => useVendorTexts())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(Array.isArray(result.current.data)).toBe(false)
    expect(result.current.data.order_texts).toBe(true)
    expect(result.current.data.recent).toEqual([])
  })

  it('test_a_400_is_not_retried', async () => {
    let calls = 0
    server.use(http.get(`${API}/api/wallet/vendor/daily/`, () => {
      calls += 1
      return HttpResponse.json({ date_from: ['Too long.'] }, { status: 400 })
    }))
    const { result } = renderWithClient(() => useVendorDaily({ dateFrom: '2020-01-01' }))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error.status).toBe(400)
    expect(calls).toBe(1)
  })

  it('test_invalidating_wallet_vendor_refetches_every_money_query', async () => {
    const counts = {}
    const paths = ['sales', 'bookings', 'daily', 'fees', 'texts']
    for (const p of paths) {
      counts[p] = 0
      server.use(http.get(`${API}/api/wallet/vendor/${p}/`, () => {
        counts[p] += 1
        return HttpResponse.json(p === 'sales' || p === 'bookings' ? PAGE : {})
      }))
    }
    const queryClient = new QueryClient()
    const { result } = renderWithClient(() => ({
      a: useVendorSales(), b: useVendorBookings(), c: useVendorDaily(), d: useVendorFees(), e: useVendorTexts(),
    }), queryClient)
    await waitFor(() => expect(Object.values(result.current).every((q) => q.isSuccess)).toBe(true))
    await queryClient.invalidateQueries({ queryKey: ['wallet', 'vendor'] })
    await waitFor(() => expect(paths.every((p) => counts[p] === 2)).toBe(true))
  })
})
