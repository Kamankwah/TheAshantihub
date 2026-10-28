import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import FeesPage from '../FeesPage.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}
const band = (over = {}) => ({ from: '0.00', to: null, percent: '1', flat: null, fee: '1%', ...over })
const cat = (key, label, over = {}) => ({
  category: key, label, applies_to: `${label} sold`, charged: true, in_force_from: '2026-10-06T06:00:00+00:00',
  bands: [band()], next: null, ...over,
})
const body = (over = {}) => ({
  categories: [cat('product', 'Products'), cat('service', 'Services'), cat('event', 'Events')],
  fee_base: 'Worked out per order on your items only.',
  fee_cap: { limit: '500.00', used: '120.00', remaining: '380.00' },
  ...over,
})
const serve = (payload, seen) => server.use(http.get(`${API}/api/wallet/vendor/fees/`, ({ request }) => {
  const params = new URL(request.url).searchParams
  seen?.push(params)
  return typeof payload === 'function' ? payload(params) : HttpResponse.json(payload)
}))
const section = async (label) => (await screen.findByRole('heading', { name: label })).closest('[data-category]')

describe('FeesPage', () => {
  it('test_each_category_shows_its_bands_and_start_day_as_sent', async () => {
    serve(body({ categories: [cat('product', 'Products', { bands: [band({ to: '100.00', fee: '2%' }), band({ from: '100.00', fee: 'GH₵ 3.00 flat' })] }), cat('service', 'Services')] }))
    wrap(<FeesPage />)
    const products = await section('Products')
    expect(within(products).getByText('Products sold')).toBeInTheDocument()
    expect(within(products).getByText('In force since 2026-10-06')).toBeInTheDocument()
    for (const h of ['From', 'To', 'Fee']) expect(within(products).getByRole('columnheader', { name: h })).toBeInTheDocument()
    expect(within(products).getByText('2%')).toBeInTheDocument()
    expect(within(products).getByText('GH₵ 3.00 flat')).toBeInTheDocument()
    expect(within(products).getAllByText('GH₵ 100.00').every((el) => el.closest('[data-amount]'))).toBe(true)
  })

  it('test_a_band_with_no_upper_limit_reads_and_above', async () => {
    serve(body())
    wrap(<FeesPage />)
    const products = await section('Products')
    expect(within(products).getByText('and above')).toBeInTheDocument()
  })

  it('test_next_approved_change_is_shown_with_its_start', async () => {
    serve(body({ categories: [cat('product', 'Products', { next: { from: '2026-12-01T06:00:00+00:00', bands: [band({ fee: '1.5%' })] } })] }))
    wrap(<FeesPage />)
    const products = await section('Products')
    expect(within(products).getByText('From 2026-12-01:')).toBeInTheDocument()
    expect(within(products).getByText('1.5%')).toBeInTheDocument()
  })

  it('test_category_with_no_rules_says_so', async () => {
    serve(body({ categories: [cat('event', 'Events', { bands: [], in_force_from: null })] }))
    wrap(<FeesPage />)
    const events = await section('Events')
    expect(within(events).getByText('No fees are set for this category.')).toBeInTheDocument()
    expect(within(events).queryByText(/In force since/)).toBeNull()
    expect(within(events).queryByRole('table')).toBeNull()
  })

  it('test_not_charged_category_is_marked', async () => {
    serve(body({ categories: [cat('service', 'Services', { charged: false }), cat('product', 'Products')] }))
    wrap(<FeesPage />)
    const services = await section('Services')
    expect(within(services).getByText('Not charged yet.')).toBeInTheDocument()
    expect(within(await section('Products')).queryByText('Not charged yet.')).toBeNull()
  })

  it('test_fee_base_text_is_the_servers', async () => {
    serve(body())
    wrap(<FeesPage />)
    expect(await screen.findByText('Worked out per order on your items only.')).toBeInTheDocument()
  })

  it('test_cap_meter_is_shown', async () => {
    serve(body())
    wrap(<FeesPage />)
    expect(await screen.findByRole('meter', { name: 'Lifetime fee cap used' })).toBeInTheDocument()
  })

  it('test_work_it_out_is_disabled_until_the_amount_is_plausible', async () => {
    serve(body())
    wrap(<FeesPage />)
    const input = await screen.findByLabelText('Sale amount (GH₵)')
    const button = screen.getByRole('button', { name: 'Work it out' })
    for (const bad of ['', '0', '1.234', 'abc', '-5']) {
      fireEvent.change(input, { target: { value: bad } })
      expect(button).toBeDisabled()
    }
    for (const good of ['50', '50.25']) {
      fireEvent.change(input, { target: { value: good } })
      expect(button).toBeEnabled()
    }
  })

  it('test_typing_sends_no_request_until_work_it_out', async () => {
    const seen = []
    serve((params) => HttpResponse.json(params.get('amount')
      ? { ...body(), quote: { category: 'service', amount: '50.00', fee: '0.50', you_receive: '49.50', charged: true } }
      : body()), seen)
    wrap(<FeesPage />)
    const input = await screen.findByLabelText('Sale amount (GH₵)')
    fireEvent.change(input, { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'service' } })
    await new Promise((r) => setTimeout(r, 50))
    expect(seen).toHaveLength(1)
    expect(seen[0].has('amount')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Work it out' }))
    await screen.findByText(/platform fee/)
    expect(seen.at(-1).get('amount')).toBe('50')
    expect(seen.at(-1).get('category')).toBe('service')
  })

  it('test_quote_shows_the_servers_fee_and_you_get', async () => {
    serve((params) => HttpResponse.json(params.get('amount')
      ? { ...body(), quote: { category: 'product', amount: '50.00', fee: '0.50', you_receive: '49.50', charged: true } }
      : body()))
    wrap(<FeesPage />)
    fireEvent.change(await screen.findByLabelText('Sale amount (GH₵)'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Work it out' }))
    const line = await screen.findByTestId('fee-quote')
    expect(line).toHaveTextContent('On a GH₵ 50.00 sale paid now: platform fee GH₵ 0.50, you get GH₵ 49.50. Your lifetime cap is counted.')
    expect(within(line).getByText('GH₵ 0.50').closest('[data-amount]')).not.toBeNull()
    expect(within(line).getByText('GH₵ 49.50').closest('[data-amount]')).not.toBeNull()
    expect(within(line).queryByText('Not charged yet.')).toBeNull()
  })

  it('test_quote_not_charged_adds_the_note', async () => {
    serve((params) => HttpResponse.json(params.get('amount')
      ? { ...body(), quote: { category: 'product', amount: '50.00', fee: '0.50', you_receive: '49.50', charged: false } }
      : body()))
    wrap(<FeesPage />)
    fireEvent.change(await screen.findByLabelText('Sale amount (GH₵)'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Work it out' }))
    const line = await screen.findByTestId('fee-quote')
    expect(line).toHaveTextContent('Not charged yet.')
  })

  it('test_quote_null_says_no_fees_set', async () => {
    serve((params) => HttpResponse.json(params.get('amount') ? { ...body(), quote: null } : body()))
    wrap(<FeesPage />)
    fireEvent.change(await screen.findByLabelText('Sale amount (GH₵)'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Work it out' }))
    expect(await screen.findByText('No fees are set for this category yet.')).toBeInTheDocument()
  })

  it('test_quote_400_shows_the_servers_message', async () => {
    serve((params) => (params.get('amount')
      ? HttpResponse.json({ amount: 'Enter a smaller amount.' }, { status: 400 })
      : HttpResponse.json(body())))
    wrap(<FeesPage />)
    fireEvent.change(await screen.findByLabelText('Sale amount (GH₵)'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Work it out' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a smaller amount.')
    expect(screen.getByRole('heading', { name: 'Products' })).toBeInTheDocument()
  })

  it('test_quote_categories_come_from_the_schedule', async () => {
    serve(body({ categories: [cat('product', 'Products'), cat('event', 'Tickets and events')] }))
    wrap(<FeesPage />)
    const select = await screen.findByLabelText('Category')
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2))
    expect(within(select).getByRole('option', { name: 'Tickets and events' })).toHaveValue('event')
  })
})
