import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useBookingPayment } from '../useBookingPayment.js'

const WALLET = 'http://localhost:8000/api/wallet/'
const QUOTE = 'http://localhost:8000/api/wallet/processing/'

function render(args) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(() => useBookingPayment(args), {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useBookingPayment', () => {
  it('ledger off sends no payment_method and needs no quote', async () => {
    let quoted = false
    server.use(
      http.get(WALLET, () => HttpResponse.json({ code: 'ledger_off', detail: 'off' }, { status: 409 })),
      http.get(QUOTE, () => { quoted = true; return HttpResponse.json({}) }),
    )
    const { result } = render({ amount: '120.00' })
    await waitFor(() => expect(result.current.state).toBe('off'))
    expect(result.current.ready).toBe(true)
    expect(result.current.body).toEqual({})
    expect(result.current.problem).toBeNull()
    expect(quoted).toBe(false)
  })

  it('ledger on with momo waits for the server quote', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    server.use(
      http.get(WALLET, () => HttpResponse.json({ kind: 'customer', balance: '500.00' })),
      http.get(QUOTE, async () => {
        await gate
        return HttpResponse.json({ amount: '120.00', payment_processing: '1.80', you_pay: '121.80', provider: 'simulated' })
      }),
    )
    const { result } = render({ amount: '120.00' })
    await waitFor(() => expect(result.current.ledgerOn).toBe(true))
    expect(result.current.method).toBe('momo')
    expect(result.current.ready).toBe(false)
    expect(result.current.body).toEqual({ payment_method: 'momo' })
    release()
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.processing).toBe('1.80')
  })

  it('wallet needs no quote and sends payment_method wallet', async () => {
    let quoted = false
    server.use(
      http.get(WALLET, () => HttpResponse.json({ kind: 'customer', balance: '500.00' })),
      http.get(QUOTE, async () => { quoted = true; await new Promise(() => {}) }),
    )
    const { result } = render({ amount: '120.00' })
    await waitFor(() => expect(result.current.ledgerOn).toBe(true))
    act(() => result.current.setMethod('wallet'))
    expect(result.current.ready).toBe(true)
    expect(result.current.body).toEqual({ payment_method: 'wallet' })
    expect(result.current.processing).toBeUndefined()
    void quoted
  })

  it('an unknown wallet answer blocks paying with a message', async () => {
    server.use(http.get(WALLET, () => HttpResponse.json({ detail: 'Wallet is down.' }, { status: 500 })))
    const { result } = render({ amount: '120.00' })
    await waitFor(() => expect(result.current.problem).toBe('Wallet is down.'))
    expect(result.current.state).toBe('unknown')
    expect(result.current.ready).toBe(false)
    expect(result.current.body).toEqual({})
  })

  it('outside the ledger it behaves as ledger off', () => {
    let asked = false
    server.use(http.get(WALLET, () => { asked = true; return HttpResponse.json({ balance: '1.00' }) }))
    const { result } = render({ amount: '120.00', inLedger: false })
    expect(result.current.state).toBe('off')
    expect(result.current.ready).toBe(true)
    expect(result.current.body).toEqual({})
    expect(asked).toBe(false)
  })
})
