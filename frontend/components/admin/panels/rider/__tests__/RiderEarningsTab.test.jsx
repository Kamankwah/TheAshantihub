import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import RiderEarningsTab from '../RiderEarningsTab.jsx'

const API = 'http://localhost:8000'
const B = `${API}/api/delivery/rider/wallet`
const mount = (ui) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
)
const me = (wallet) => http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json({ rider: { id: 1, full_name: 'Kofi', wallet } }))
const payroll = http.get(`${API}/api/delivery/rider/earnings/`, () => HttpResponse.json({
  total: null, results: [], jobs: 0, jobs_without_pay: 0, could_not_deliver: 0, rates: null, payouts: { note: 'Payouts are prepared by Accounting.' },
}))
const summary = { kind: 'rider', balance: '20.00', reserve: '1.00', reserve_note: '', commission_bp: 1050, company_name: '', awaiting_release: 0 }
const walletOn = (extra = []) => server.use(
  me(true), payroll,
  http.get(`${B}/`, () => HttpResponse.json(summary)),
  http.get(`${B}/earnings/`, () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })),
  http.get(`${B}/days/`, () => HttpResponse.json({ results: [] })),
  http.get(`${B}/statement/`, () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })),
  http.get(`${B}/destinations/`, () => HttpResponse.json({ results: [] })),
  http.get(`${B}/withdrawals/`, () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })),
  ...extra,
)

describe('RiderEarningsTab', () => {
  it('an AshantiHub rider sees the payroll earnings and no wallet call is made', async () => {
    let walletCalls = 0
    server.use(me(false), payroll, http.get(`${B}/`, () => { walletCalls += 1; return HttpResponse.json(summary) }))
    mount(<RiderEarningsTab />)
    expect(await screen.findByText(/Payments are simulated/)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Wallet' })).toBeNull()
    expect(walletCalls).toBe(0)
  })

  it('a third-party rider sees the wallet tabs', async () => {
    walletOn()
    mount(<RiderEarningsTab />)
    expect(await screen.findByRole('tab', { name: 'Wallet' })).toHaveAttribute('aria-selected', 'true')
    for (const t of ['Deliveries', 'Days', 'Statement']) expect(screen.getByRole('tab', { name: t })).toBeInTheDocument()
    expect(await screen.findByText('Your balance')).toBeInTheDocument()
  })

  it('ledger off shows the payroll earnings with the wallet note', async () => {
    server.use(me(true), payroll)
    mount(<RiderEarningsTab />)
    expect(await screen.findByText(/Your AshantiHub wallet opens when wallets are switched on/)).toBeInTheDocument()
    expect(screen.getByText(/Payments are simulated/)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Wallet' })).toBeNull()
  })

  it('wallet_disabled falls back to payroll earnings', async () => {
    server.use(me(true), payroll, http.get(`${B}/`, () => HttpResponse.json({ detail: 'Wallets are for third-party riders.', code: 'wallet_disabled' }, { status: 409 })))
    mount(<RiderEarningsTab />)
    expect(await screen.findByText(/Payments are simulated/)).toBeInTheDocument()
    expect(screen.queryByText(/wallet opens when wallets are switched on/)).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Wallet' })).toBeNull()
  })

  it('keeps the loaded wallet when a refresh fails, with a Try again note', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
    let calls = 0
    walletOn()
    server.use(http.get(`${B}/`, () => { calls += 1; return calls === 1 ? HttpResponse.json(summary) : HttpResponse.json({ detail: 'boom' }, { status: 500 }) }))
    render(<QueryClientProvider client={qc}><RiderEarningsTab /></QueryClientProvider>)
    await screen.findByText('Your balance')
    await qc.invalidateQueries({ queryKey: ['rider-wallet'] })
    expect(await screen.findByText(/Could not refresh your wallet/)).toBeInTheDocument()
    expect(screen.getByText('Your balance')).toBeInTheDocument()
    expect(screen.queryByText('Could not load your wallet.')).toBeNull()
    const before = calls
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(calls).toBeGreaterThan(before))
  })

  it('the payroll record opens from the wallet', async () => {
    walletOn()
    mount(<RiderEarningsTab />)
    await screen.findByText('Your balance')
    expect(screen.queryByText(/Payments are simulated/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pay for earlier deliveries' }))
    expect(screen.getByText('Deliveries on orders paid before wallets were switched on are paid through payroll.')).toBeInTheDocument()
    expect(await screen.findByText(/Payments are simulated/)).toBeInTheDocument()
  })

  it('each tab shows its screen', async () => {
    walletOn()
    mount(<RiderEarningsTab />)
    await screen.findByText('Your balance')
    fireEvent.click(screen.getByRole('tab', { name: 'Deliveries' }))
    expect(await screen.findByText('No delivery has been paid to your wallet yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Days' }))
    expect(await screen.findByText(/No day has been posted yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Statement' }))
    await waitFor(() => expect(screen.queryByText(/No day has been posted yet/)).toBeNull())
    expect(screen.getByRole('tab', { name: 'Statement' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText('Your balance')).toBeNull()
  })
})
