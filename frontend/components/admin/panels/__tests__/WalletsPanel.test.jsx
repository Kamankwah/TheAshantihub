import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import WalletsPanel from '../WalletsPanel.jsx'
import { NAV_ITEMS } from '../../shell/navModel.js'

const API = 'http://localhost:8000/api/wallet/staff/wallets/'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const envelope = (results, next = null) => HttpResponse.json({ count: results.length, next, previous: null, results })
const byKind = (map) => http.get(API, ({ request }) => map[new URL(request.url).searchParams.get('kind')](new URL(request.url)))

describe('Staff wallets list', () => {
  it('test_customers_tab_lists_name_and_balance', async () => {
    server.use(byKind({ customer: () => envelope([{ holder_id: 1, name: 'Ama Mensah', balance: '25.50' }]) }))
    wrap(<WalletsPanel />)
    const row = (await screen.findByText('Ama Mensah')).closest('li')
    expect(row).toHaveTextContent('GH₵ 25.50')
  })

  it('test_vendors_tab_lists_pending_and_available_and_flags_below_zero', async () => {
    server.use(byKind({
      customer: () => envelope([]),
      vendor: () => envelope([
        { holder_id: 2, name: 'Kofi Stores', pending: '10.00', available: '40.00' },
        { holder_id: 3, name: 'Yaw Shop', pending: '0.00', available: '-5.00' },
      ]),
    }))
    wrap(<WalletsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Vendors' }))
    const ok = (await screen.findByText('Kofi Stores')).closest('li')
    expect(ok).toHaveTextContent('Pending')
    expect(ok).toHaveTextContent('GH₵ 10.00')
    expect(ok).toHaveTextContent('GH₵ 40.00')
    expect(within(ok).queryByText('Below zero')).toBeNull()
    const bad = screen.getByText('Yaw Shop').closest('li')
    expect(bad).toHaveTextContent('-GH₵ 5.00')
    expect(within(bad).getByText('Below zero')).toBeInTheDocument()
  })

  it('test_riders_tab_passes_through_the_servers_fields_only', async () => {
    server.use(byKind({
      customer: () => envelope([]),
      rider: () => envelope([{ holder_id: 7, rider_id: 3, name: 'Kwesi Rider', company_name: 'Swift Co', employment: 'third_party', balance: '12.00', reserve: '3.00' }]),
    }))
    wrap(<WalletsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Riders' }))
    const row = (await screen.findByText('Kwesi Rider')).closest('li')
    expect(row).toHaveTextContent('Swift Co')
    expect(row).toHaveTextContent('Balance')
    expect(row).toHaveTextContent('GH₵ 12.00')
    expect(row).toHaveTextContent('Reserve')
    expect(row).toHaveTextContent('GH₵ 3.00')
    expect(row).not.toHaveTextContent('Pending')
    expect(row).not.toHaveTextContent('Available')
  })

  it('test_load_more_follows_next', async () => {
    const seen = []
    server.use(http.get(API, ({ request }) => {
      const page = new URL(request.url).searchParams.get('page')
      seen.push(page)
      return page === '2'
        ? envelope([{ holder_id: 2, name: 'Second Person', balance: '2.00' }])
        : envelope([{ holder_id: 1, name: 'First Person', balance: '1.00' }], `${API}?kind=customer&page=2`)
    }))
    wrap(<WalletsPanel />)
    await screen.findByText('First Person')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('Second Person')
    expect(screen.getByText('First Person')).toBeInTheDocument()
    expect(seen).toEqual(['1', '2'])
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('test_ledger_off_state', async () => {
    server.use(http.get(API, () => HttpResponse.json({ detail: 'off', code: 'ledger_off' }, { status: 409 })))
    wrap(<WalletsPanel />)
    expect(await screen.findByText("Wallets aren't switched on yet.")).toBeInTheDocument()
  })

  it('shows a 403 with the server words', async () => {
    server.use(http.get(API, () => HttpResponse.json({ detail: 'You do not have permission.' }, { status: 403 })))
    wrap(<WalletsPanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission.')
  })

  it('refresh asks the server again', async () => {
    let calls = 0
    server.use(http.get(API, () => { calls += 1; return envelope([{ holder_id: 1, name: 'Ama Mensah', balance: '1.00' }]) }))
    wrap(<WalletsPanel />)
    await screen.findByText('Ama Mensah')
    const before = calls
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(calls).toBeGreaterThan(before))
  })

  it('test_no_edit_controls', async () => {
    server.use(byKind({ customer: () => envelope([{ holder_id: 1, name: 'Ama Mensah', balance: '25.50' }]) }))
    wrap(<WalletsPanel />)
    await screen.findByText('Ama Mensah')
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /edit|adjust|set|credit|debit/i })).toBeNull()
  })

  it('test_panel_is_hidden_without_wallets_view', () => {
    const item = NAV_ITEMS.find((i) => i.id === 'wallets')
    expect(item.show({ hasPermission: () => false })).toBe(false)
    expect(item.show({ hasPermission: (c) => c === 'wallets.view' })).toBe(true)
  })
})
