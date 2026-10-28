import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import { RiderDays, RiderDeliveries, RiderStatement } from '../RiderWalletHistory.jsx'

const API = 'http://localhost:8000'
const B = `${API}/api/delivery/rider/wallet`
const mount = (ui) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
)
const earning = (o = {}) => ({
  id: 1, order: 501, kind: 'delivery', delivered_at: '2026-10-20T10:30:00Z', earned_at: '2026-10-20T10:31:00Z', earned_on: '2026-10-20',
  gross: '12.00', commission_bp: 1050, commission: '1.26', you_got: '10.74', status: 'paid', status_label: 'Paid to your wallet', reversed_at: null, ...o,
})
const earnings = (results, next = null) => server.use(
  http.get(`${B}/earnings/`, () => HttpResponse.json({ count: results.length, next, previous: null, results })),
)
const day = (o = {}) => ({ day: '2026-10-19', deliveries: 4, gross: '48.00', commission: '5.04', net: '42.96', given_back: '0.00', ...o })
const days = (results) => server.use(http.get(`${B}/days/`, () => HttpResponse.json({ results })))
const line = (o = {}) => ({
  id: 1, at: '2026-10-20T10:30:00Z', account: 'balance', kind: 'rider_earning', label: 'Delivery earning', direction: 'in',
  amount: '10.74', order: 501, reference: '', ...o,
})
const statement = (results) => server.use(
  http.get(`${B}/statement/`, () => HttpResponse.json({ count: results.length, next: null, previous: null, results })),
)

describe('RiderDeliveries', () => {
  it('lists each delivery with fee, commission, what the rider got and the server\'s status label', async () => {
    earnings([earning()])
    mount(<RiderDeliveries />)
    const li = (await screen.findByText('Order #501')).closest('li')
    expect(within(li).getByText(/Delivery fee/)).toHaveTextContent('Delivery fee GH₵ 12.00')
    expect(within(li).getByText(/commission/)).toHaveTextContent("AshantiHub's commission (10.5%) GH₵ 1.26")
    expect(within(li).getByText(/You got/)).toHaveTextContent('You got GH₵ 10.74')
    expect(within(li).getByText('Paid to your wallet')).toBeInTheDocument()
  })

  it('a re-delivery earning reads as a re-delivery of the order', async () => {
    earnings([earning({ id: 2, order: 77, kind: 'redelivery' })])
    mount(<RiderDeliveries />)
    expect(await screen.findByText('Re-delivery of order #77')).toBeInTheDocument()
    expect(screen.queryByText('Order #77')).toBeNull()
  })

  it('filters by one day through the day query', async () => {
    const seen = []
    server.use(http.get(`${B}/earnings/`, ({ request }) => {
      const u = new URL(request.url)
      seen.push(u.searchParams.get('day'))
      return HttpResponse.json({ count: 1, next: null, previous: null, results: [earning({ id: u.searchParams.get('day') ? 9 : 1, order: u.searchParams.get('day') ? 900 : 501 })] })
    }))
    mount(<RiderDeliveries />)
    await screen.findByText('Order #501')
    fireEvent.change(screen.getByLabelText(/show one day/i), { target: { value: '2026-10-19' } })
    expect(await screen.findByText('Order #900')).toBeInTheDocument()
    expect(seen).toContain('2026-10-19')
    expect(seen[0]).toBeNull()
  })

  it('load more follows next and appends', async () => {
    server.use(http.get(`${B}/earnings/`, ({ request }) => {
      const p = new URL(request.url).searchParams.get('page')
      return p === '2'
        ? HttpResponse.json({ count: 2, next: null, previous: 'x', results: [earning({ id: 2, order: 502 })] })
        : HttpResponse.json({ count: 2, next: `${B}/earnings/?page=2`, previous: null, results: [earning({ id: 1, order: 501 })] })
    }))
    mount(<RiderDeliveries />)
    await screen.findByText('Order #501')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Order #502')).toBeInTheDocument()
    expect(screen.getByText('Order #501')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('a failed page 2 is retried by Load more, not skipped', async () => {
    const asked = []
    let fail = true
    server.use(http.get(`${B}/earnings/`, ({ request }) => {
      const p = new URL(request.url).searchParams.get('page')
      asked.push(p)
      if (p === '2' && fail) return HttpResponse.json({ detail: 'Try again.' }, { status: 500 })
      return p === '2'
        ? HttpResponse.json({ count: 3, next: `${B}/earnings/?page=3`, previous: 'x', results: [earning({ id: 2, order: 502 })] })
        : HttpResponse.json({ count: 3, next: `${B}/earnings/?page=2`, previous: null, results: [earning({ id: 1, order: 501 })] })
    }))
    mount(<RiderDeliveries />)
    await screen.findByText('Order #501')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(asked).toContain('2'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeNull())
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Order #502')).toBeInTheDocument()
    expect(asked).not.toContain('3')
  })

  it('a day change after Load more starts again from page 1 of that day', async () => {
    server.use(http.get(`${B}/earnings/`, ({ request }) => {
      const u = new URL(request.url)
      const d = u.searchParams.get('day')
      if (d) return HttpResponse.json({ count: 1, next: null, previous: null, results: [earning({ id: 50, order: 950 })] })
      return u.searchParams.get('page') === '2'
        ? HttpResponse.json({ count: 2, next: null, previous: 'x', results: [earning({ id: 2, order: 502 })] })
        : HttpResponse.json({ count: 2, next: `${B}/earnings/?page=2`, previous: null, results: [earning({ id: 1, order: 501 })] })
    }))
    mount(<RiderDeliveries />)
    await screen.findByText('Order #501')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('Order #502')
    fireEvent.change(screen.getByLabelText(/show one day/i), { target: { value: '2026-10-19' } })
    expect(await screen.findByText('Order #950')).toBeInTheDocument()
    expect(screen.queryByText('Order #501')).toBeNull()
    expect(screen.queryByText('Order #502')).toBeNull()
  })

  it('empty deliveries text', async () => {
    earnings([])
    mount(<RiderDeliveries />)
    expect(await screen.findByText('No delivery has been paid to your wallet yet.')).toBeInTheDocument()
  })
})

describe('RiderDays', () => {
  it('lists each day with deliveries, fees, commission and net', async () => {
    days([day(), day({ day: '2026-10-18', deliveries: 2, gross: '24.00', commission: '2.52', net: '21.48' })])
    mount(<RiderDays />)
    const row = (await screen.findByText('2026-10-19')).closest('tr')
    expect(within(row).getByText('4')).toBeInTheDocument()
    expect(within(row).getByText('GH₵ 48.00')).toBeInTheDocument()
    expect(within(row).getByText('GH₵ 5.04')).toBeInTheDocument()
    expect(within(row).getByText('GH₵ 42.96')).toBeInTheDocument()
    for (const h of ['Day', 'Deliveries', 'Delivery fees', 'Commission', 'You got']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Given back' })).toBeNull()
  })

  it('shows commission given back only when it is not zero', async () => {
    days([day(), day({ day: '2026-10-18', given_back: '1.26' })])
    mount(<RiderDays />)
    expect(await screen.findByRole('columnheader', { name: 'Given back' })).toBeInTheDocument()
    expect(screen.getByText('GH₵ 1.26')).toBeInTheDocument()
  })

  it('empty days text says commission is taken after midnight', async () => {
    days([])
    mount(<RiderDays />)
    expect(await screen.findByText("No day has been posted yet. AshantiHub's commission for a day is taken after midnight, Accra time.")).toBeInTheDocument()
  })
})

describe('RiderStatement', () => {
  it('the statement reads the rider statement path', async () => {
    statement([line()])
    mount(<RiderStatement />)
    expect(await screen.findByText('Delivery earning')).toBeInTheDocument()
    expect(screen.getByText('+GH₵ 10.74')).toBeInTheDocument()
  })

  it('labels reserve lines as commission held', async () => {
    statement([line({ id: 2, account: 'reserve', label: 'Commission held', kind: 'rider_reserve_hold', direction: 'out', amount: '1.26' })])
    mount(<RiderStatement />)
    const li = (await screen.findByText('Commission held', { selector: 'div' })).closest('li')
    expect(within(li).getByText('commission held')).toBeInTheDocument()
  })

  it('the statement shows the server\'s "Re-delivery paid to you" label', async () => {
    statement([line({ id: 3, kind: 'rider_redelivery_earning', label: 'Re-delivery paid to you', amount: '15.00' })])
    mount(<RiderStatement />)
    expect(await screen.findByText('Re-delivery paid to you')).toBeInTheDocument()
  })

  it('the statement has no order links and no filter chips', async () => {
    statement([line({ order: 501 }), line({ id: 2, kind: 'order_payment', label: 'Other', order: 9 })])
    mount(<RiderStatement />)
    await screen.findByText('Delivery earning')
    expect(screen.queryByRole('link')).toBeNull()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'All' })).toBeNull())
  })
})
