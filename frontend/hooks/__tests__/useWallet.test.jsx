import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useVendorWalletOverview, useWallet } from '../useWallet.js'
import { useWalletDestinations } from '../useWalletDestinations.js'
import { useWalletProcessing } from '../useWalletProcessing.js'
import { useWalletTransactions } from '../useWalletTransactions.js'

const API = 'http://localhost:8000'

// No `retry` override: the hooks' own retry rule is part of what is tested.
function renderWithClient(hook) {
  const queryClient = new QueryClient()
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('wallet hooks', () => {
  it('test_returns_the_customer_summary_as_sent', async () => {
    server.use(http.get(`${API}/api/wallet/`, () => HttpResponse.json({ kind: 'customer', balance: '125.50', held_topup_pesewas: 500 })))
    const { result } = renderWithClient(() => useWallet())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ kind: 'customer', balance: '125.50', held_topup_pesewas: 500 })
  })

  it('test_returns_the_vendor_summary_as_sent', async () => {
    server.use(
      http.get(`${API}/api/wallet/`, () => HttpResponse.json({ kind: 'vendor', pending: '10.00', available: '4.00' })),
      http.get(`${API}/api/wallet/vendor/`, () => HttpResponse.json({
        pending: '10.00', available: '4.00', withdrawable: '4.00', negative: false, awaiting_call: false, fee_cap: '5.00',
      })),
    )
    const wallet = renderWithClient(() => useWallet())
    await waitFor(() => expect(wallet.result.current.isSuccess).toBe(true))
    expect(wallet.result.current.data).toEqual({ kind: 'vendor', pending: '10.00', available: '4.00' })
    const overview = renderWithClient(() => useVendorWalletOverview())
    await waitFor(() => expect(overview.result.current.isSuccess).toBe(true))
    expect(overview.result.current.data.withdrawable).toBe('4.00')
  })

  it('test_ledger_off_is_not_retried', async () => {
    let calls = 0
    server.use(http.get(`${API}/api/wallet/`, () => {
      calls += 1
      return HttpResponse.json({ detail: 'Wallets are off.', code: 'ledger_off' }, { status: 409 })
    }))
    const { result } = renderWithClient(() => useWallet())
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error.body.code).toBe('ledger_off')
    expect(calls).toBe(1)
  })

  it('test_transactions_follow_page_and_read_results', async () => {
    const pages = []
    server.use(http.get(`${API}/api/wallet/transactions/`, ({ request }) => {
      const page = new URL(request.url).searchParams.get('page')
      pages.push(page)
      return HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: Number(page) }] })
    }))
    const { result } = renderWithClient(() => useWalletTransactions(1))
    await waitFor(() => expect(result.current.data?.results).toEqual([{ id: 1 }]))
    expect(pages).toEqual(['1'])
    const second = renderWithClient(() => useWalletTransactions(2))
    await waitFor(() => expect(second.result.current.data?.results).toEqual([{ id: 2 }]))
    expect(pages).toEqual(['1', '2'])
  })

  it('test_processing_not_asked_for_an_implausible_amount', async () => {
    let calls = 0
    server.use(http.get(`${API}/api/wallet/processing/`, ({ request }) => {
      calls += 1
      const amount = new URL(request.url).searchParams.get('amount')
      return HttpResponse.json({ amount, payment_processing: '0.75', you_pay: '50.75', provider: 'simulated' })
    }))
    const bad = renderWithClient(() => useWalletProcessing('1.234'))
    const empty = renderWithClient(() => useWalletProcessing(''))
    expect(bad.result.current.fetchStatus).toBe('idle')
    expect(empty.result.current.fetchStatus).toBe('idle')
    const good = renderWithClient(() => useWalletProcessing('50'))
    await waitFor(() => expect(good.result.current.isSuccess).toBe(true))
    expect(good.result.current.data.you_pay).toBe('50.75')
    expect(calls).toBe(1)
  })

  it('test_destinations_use_the_base_path', async () => {
    server.use(
      http.get(`${API}/api/wallet/vendor/destinations/`, () => HttpResponse.json({ results: [{ id: 7 }], cooling_hours: 24 })),
    )
    const { result } = renderWithClient(() => useWalletDestinations({ basePath: '/api/wallet/vendor' }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.results).toEqual([{ id: 7 }])
  })
})
