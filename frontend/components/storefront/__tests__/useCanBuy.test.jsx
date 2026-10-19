import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { setStoredAuth } from '../../../apiClient.js'
import { server } from '../../../mocks/server.js'
import { gatedOpening } from '../../../mocks/opening.js'
import { useCanBuy } from '../../../hooks/useCanBuy.js'
import NotifyStopPage from '../NotifyStopPage.jsx'

const ME_URL = 'http://localhost:8000/api/accounts/me/'
const FUTURE = '2026-11-06T06:00:00Z'
const BEFORE = '2026-11-01T06:00:00Z'

function wrapper({ children }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

afterEach(() => setStoredAuth(null))

describe('useCanBuy', () => {
  it('can buy while the gate is off, without asking for the account', async () => {
    let askedMe = false
    server.use(http.get(ME_URL, () => { askedMe = true; return HttpResponse.json({}) }))
    setStoredAuth({ token: 't', account_type: 'customer' })
    const { result } = renderHook(() => useCanBuy(), { wrapper })
    await new Promise((r) => setTimeout(r, 50))
    expect(result.current.canBuy).toBe(true)
    expect(result.current.label).toBeNull()
    expect(askedMe).toBe(false)
  })

  it('a signed-out visitor cannot buy before opening, labelled from opens_at', async () => {
    server.use(gatedOpening({ opensAt: FUTURE, serverNow: BEFORE }))
    const { result } = renderHook(() => useCanBuy(), { wrapper })
    await waitFor(() => expect(result.current.canBuy).toBe(false))
    expect(result.current.label).toBe('Opens 6 Nov')
  })

  it('a customer the server says cannot buy stays disabled', async () => {
    server.use(gatedOpening({ opensAt: FUTURE, serverNow: BEFORE }),
      http.get(ME_URL, () => HttpResponse.json({ id: 1, can_buy: false })))
    setStoredAuth({ token: 't', account_type: 'customer' })
    const { result } = renderHook(() => useCanBuy(), { wrapper })
    await waitFor(() => expect(result.current.canBuy).toBe(false))
    await new Promise((r) => setTimeout(r, 50))
    expect(result.current.canBuy).toBe(false)
  })

  it('an allowlisted tester (can_buy true) can buy before opening', async () => {
    server.use(gatedOpening({ opensAt: FUTURE, serverNow: BEFORE }),
      http.get(ME_URL, () => HttpResponse.json({ id: 1, can_buy: true })))
    setStoredAuth({ token: 't', account_type: 'customer' })
    const { result } = renderHook(() => useCanBuy(), { wrapper })
    await waitFor(() => expect(result.current.canBuy).toBe(true))
    expect(result.current.label).toBeNull()
  })
})

describe('NotifyStopPage', () => {
  it('posts the token and shows the fixed confirmation', async () => {
    let body = null
    server.use(http.post('http://localhost:8000/api/storefront/notify-me/stop/', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ status: 'stopped' })
    }))
    render(<NotifyStopPage token="abc.def" />, { wrapper })
    expect(await screen.findByText('You will not get the opening message.')).toBeInTheDocument()
    expect(body).toEqual({ token: 'abc.def' })
  })
})
