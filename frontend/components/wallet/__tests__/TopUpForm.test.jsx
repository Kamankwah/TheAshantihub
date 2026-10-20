import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import TopUpForm from '../TopUpForm.jsx'

const API = 'http://localhost:8000'
const renderForm = (props = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const spy = vi.spyOn(queryClient, 'invalidateQueries')
  render(<QueryClientProvider client={queryClient}><TopUpForm {...props} /></QueryClientProvider>)
  return { spy }
}
const type = (v) => fireEvent.change(screen.getByLabelText(/amount to add/i), { target: { value: v } })
const posts = () => {
  const calls = []
  server.use(http.post(`${API}/api/wallet/top-up/`, async ({ request }) => {
    calls.push(await request.json())
    return HttpResponse.json({ mode: 'immediate', kind: 'customer', balance: '60.00' }, { status: 201 })
  }))
  return calls
}

afterEach(() => vi.restoreAllMocks())

describe('TopUpForm', () => {
  it('test_bad_amounts_send_no_request', async () => {
    const calls = posts()
    renderForm()
    for (const v of ['', '0', '1.234', 'abc', '-5']) {
      type(v)
      expect(screen.getByRole('button', { name: 'Top up' })).toBeDisabled()
      fireEvent.submit(screen.getByRole('button', { name: 'Top up' }).closest('form'))
    }
    await new Promise((r) => setTimeout(r, 30))
    expect(calls).toHaveLength(0)
  })

  it('test_processing_line_shows_the_servers_numbers', async () => {
    server.use(http.get(`${API}/api/wallet/processing/`, () => HttpResponse.json({ amount: '50.00', payment_processing: '0.75', you_pay: '50.75', provider: 'hubtel' })))
    renderForm()
    type('50')
    expect(await screen.findByText('GH₵ 0.75')).toBeInTheDocument()
    expect(screen.getByText('GH₵ 50.75')).toBeInTheDocument()
    expect(screen.getByText('You pay GH₵ 50.75 (includes GH₵ 0.75 payment processing); GH₵ 50.00 reaches your wallet.')).toBeInTheDocument()
  })

  it('test_zero_processing_says_no_charge_not_a_made_up_figure', async () => {
    renderForm()
    type('20')
    expect(await screen.findByText('No payment processing charge')).toBeInTheDocument()
    expect(screen.queryByText(/includes/)).toBeNull()
  })

  it('test_immediate_top_up_refreshes_the_balance_and_calls_onDone', async () => {
    const calls = posts()
    const onDone = vi.fn()
    const { spy } = renderForm({ onDone })
    type('10.50')
    fireEvent.click(screen.getByRole('button', { name: 'Top up' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ balance: '60.00' })))
    expect(calls).toEqual([{ amount: '10.50' }])
    expect(spy).toHaveBeenCalledWith({ queryKey: ['wallet'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['wallet', 'transactions'] })
  })

  it('test_redirect_answer_navigates_to_checkout_url', async () => {
    server.use(http.post(`${API}/api/wallet/top-up/`, () => HttpResponse.json({ mode: 'redirect', checkout_url: 'https://pay.example/c/1' })))
    const original = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { href: 'http://localhost/' } })
    try {
      renderForm()
      type('10')
      fireEvent.click(screen.getByRole('button', { name: 'Top up' }))
      await waitFor(() => expect(window.location.href).toBe('https://pay.example/c/1'))
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })

  it('test_server_refusal_text_is_shown_verbatim', async () => {
    server.use(http.post(`${API}/api/wallet/top-up/`, () => HttpResponse.json({ amount: ['That amount is too large.'] }, { status: 400 })))
    renderForm()
    type('99999')
    fireEvent.click(screen.getByRole('button', { name: 'Top up' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That amount is too large.')
  })

  it('test_double_click_posts_once', async () => {
    const calls = posts()
    renderForm()
    type('10')
    const button = screen.getByRole('button', { name: 'Top up' })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(calls).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 30))
    expect(calls).toHaveLength(1)
  })

  it('test_ledger_off_shows_the_off_state_and_no_form', async () => {
    server.use(http.get(`${API}/api/wallet/`, () => HttpResponse.json({ detail: 'off', code: 'ledger_off' }, { status: 409 })))
    renderForm()
    expect(await screen.findByText("Wallets aren't switched on yet.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Top up' })).toBeNull()
    expect(screen.queryByLabelText(/amount to add/i)).toBeNull()
  })

  it('test_no_card_fields_exist', () => {
    renderForm()
    const inputs = document.querySelectorAll('input')
    expect(inputs).toHaveLength(1)
    expect(screen.queryByLabelText(/card|cvv|expiry/i)).toBeNull()
  })
})
