import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import PaymentVerifyPage from '../shop/PaymentVerifyPage.jsx'

vi.mock('../../apiClient.js', () => ({ apiFetch: vi.fn() }))
import { apiFetch } from '../../apiClient.js'

const SESSION = {
  reference: 'AH-3F2A9C1B', kind: 'order_checkout', amount: '265.00', purpose: 'AshantiHub Order #214',
  status: 'pending', checkout_url: 'https://pay.hubtel.com/abc', created_at: '2026-10-28T09:00:00Z',
  processing_fee: '5.00', wallet: false, order_id: 214,
}
const ORDER = { id: 214, status: 'paid', total_amount: '265.00', items: [] }

function Probe() { const l = useLocation(); return <div data-testid="loc">{l.pathname}</div> }
function renderAt(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="*" element={<><PaymentVerifyPage /><Probe /></>} /></Routes>
    </MemoryRouter>,
  )
}
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const notFound = () => Object.assign(new Error('Not found'), { status: 404 })

beforeEach(() => { vi.useFakeTimers(); apiFetch.mockReset() })
afterEach(() => { vi.useRealTimers() })

describe('PaymentVerifyPage', () => {
  test('polls until the status leaves pending, then stops', async () => {
    apiFetch.mockResolvedValueOnce(SESSION).mockResolvedValueOnce(SESSION).mockResolvedValue({ ...SESSION, status: 'success' })
    renderAt('/checkout/verify?reference=AH-3F2A9C1B')
    await flush()
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(apiFetch).toHaveBeenCalledWith('/api/payments/checkout-sessions/AH-3F2A9C1B/')
    expect(screen.getByText(/approve the payment prompt on your phone/i)).toBeInTheDocument()
    await flush(2000)
    expect(apiFetch).toHaveBeenCalledTimes(2)
    await flush(2000)
    expect(apiFetch).toHaveBeenCalledTimes(3)
    expect(screen.getByText('Payment confirmed')).toBeInTheDocument()
    await flush(20000)
    expect(apiFetch).toHaveBeenCalledTimes(3)
  })

  test('success shows confirmed with the amount, processing fee and method', async () => {
    apiFetch.mockResolvedValue({ ...SESSION, status: 'success' })
    renderAt('/payment/return?reference=AH-3F2A9C1B')
    await flush()
    expect(screen.getByText('Verify payment')).toBeInTheDocument()
    expect(screen.getByText('Payment confirmed')).toBeInTheDocument()
    expect(screen.getByText('AshantiHub')).toBeInTheDocument()
    expect(screen.getByText('GHS 265.00')).toBeInTheDocument()
    expect(screen.getByText('GHS 5.00')).toBeInTheDocument()
    expect(screen.getByText('Mobile money')).toBeInTheDocument()
    expect(screen.getByText('AH-3F2A9C1B')).toBeInTheDocument()
    expect(screen.getByText('#214')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View your order' }))
    expect(screen.getByTestId('loc')).toHaveTextContent('/my-account/orders')
  })

  test('continue shopping goes home after an order payment', async () => {
    apiFetch.mockResolvedValue({ ...SESSION, status: 'success' })
    renderAt('/payment/return?reference=R')
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Continue shopping' }))
    expect(screen.getByTestId('loc')).toHaveTextContent(/^\/$/)
  })

  test('wallet payment says wallet and shows no phone number, with the processing row hidden at 0.00', async () => {
    apiFetch.mockResolvedValue({ ...SESSION, status: 'success', wallet: true, processing_fee: '0.00', phone: '0241234567' })
    renderAt('/checkout/verify?reference=R')
    await flush()
    expect(screen.getByText('AshantiHub wallet')).toBeInTheDocument()
    expect(screen.queryByText('Mobile money')).not.toBeInTheDocument()
    expect(screen.queryByText(/payment processing/i)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/0241234567/)
  })

  test('failed shows try again and exit', async () => {
    apiFetch.mockResolvedValue({ ...SESSION, status: 'failed' })
    renderAt('/checkout/verify?reference=R')
    await flush()
    expect(screen.getByText('Payment failed')).toBeInTheDocument()
    expect(screen.queryByText('Payment confirmed')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View your order' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }))
    expect(screen.getByTestId('loc')).toHaveTextContent('/cart')
  })

  test('failed order payment retries back at checkout', async () => {
    apiFetch.mockResolvedValue({ ...SESSION, status: 'expired' })
    renderAt('/checkout/verify?reference=R')
    await flush()
    expect(screen.getByText('Payment expired')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByTestId('loc')).toHaveTextContent('/checkout')
  })

  test('other session kinds keep the generic copy and never offer order actions', async () => {
    apiFetch.mockResolvedValue({ ...SESSION, kind: 'service_request', order_id: null, status: 'success', purpose: 'Service request #9' })
    renderAt('/payment/return?reference=R')
    await flush()
    expect(screen.getByText('Payment confirmed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View your order' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue shopping' })).not.toBeInTheDocument()
    expect(screen.queryByText('Order #')).not.toBeInTheDocument()
    expect(screen.getByText('For')).toBeInTheDocument()
    expect(screen.getByText('Service request #9')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to AshantiHub' }))
    expect(screen.getByTestId('loc')).toHaveTextContent(/^\/$/)
  })

  test('a failed non-order payment keeps the old retry copy and no checkout link', async () => {
    apiFetch.mockResolvedValue({ ...SESSION, kind: 'booking', order_id: null, status: 'failed' })
    renderAt('/payment/return?reference=R')
    await flush()
    expect(screen.getByText(/your payment could not be completed\. please try again/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to AshantiHub' })).toBeInTheDocument()
  })

  test('a wallet top-up goes back to the account', async () => {
    apiFetch.mockResolvedValue({ ...SESSION, kind: 'wallet_topup', order_id: null, status: 'success' })
    renderAt('/payment/return?reference=R')
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Back to your account' }))
    expect(screen.getByTestId('loc')).toHaveTextContent('/my-account')
  })

  test('timeout after 60 seconds shows the honest wait message', async () => {
    apiFetch.mockResolvedValue(SESSION)
    renderAt('/checkout/verify?reference=R')
    await flush()
    expect(screen.queryByText(/still waiting for the provider/i)).not.toBeInTheDocument()
    await flush(58000)
    expect(screen.queryByText(/still waiting for the provider/i)).not.toBeInTheDocument()
    await flush(4000)
    expect(screen.getByText(/we are still waiting for the provider — check your orders for the latest status\./i)).toBeInTheDocument()
    const calls = apiFetch.mock.calls.length
    await flush(20000)
    expect(apiFetch).toHaveBeenCalledTimes(calls)
  })

  test('the return url alone never shows success', async () => {
    apiFetch.mockResolvedValue(SESSION)
    renderAt('/payment/return?reference=R&status=success&order=214')
    await flush()
    expect(screen.queryByText('Payment confirmed')).not.toBeInTheDocument()
    expect(screen.getByText(/approve the payment prompt/i)).toBeInTheDocument()
  })

  test('order-only link reads the order and shows its status', async () => {
    apiFetch.mockResolvedValue(ORDER)
    renderAt('/checkout/verify?order=214')
    await flush()
    expect(apiFetch).toHaveBeenCalledWith('/api/orders/214/')
    expect(screen.getByText('Payment confirmed')).toBeInTheDocument()
    expect(screen.getByText('GHS 265.00')).toBeInTheDocument()
    expect(screen.getByText('#214')).toBeInTheDocument()
  })

  test('an order-only link to an unpaid order says it is pending, not paid', async () => {
    apiFetch.mockResolvedValue({ ...ORDER, status: 'pending' })
    renderAt('/checkout/verify?order=214')
    await flush()
    expect(screen.queryByText('Payment confirmed')).not.toBeInTheDocument()
    expect(screen.getByText(/waiting for the payment/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue shopping' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View your order' }))
    expect(screen.getByTestId('loc')).toHaveTextContent('/my-account/orders')
  })

  test('missing reference and order shows an error', async () => {
    renderAt('/checkout/verify')
    await flush()
    expect(screen.getByText(/no payment reference found/i)).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  test("another customer's reference (404) shows the error state", async () => {
    apiFetch.mockRejectedValue(notFound())
    renderAt('/checkout/verify?reference=OTHER')
    await flush()
    expect(screen.getByText(/could not check this payment/i)).toBeInTheDocument()
    expect(screen.queryByText('Payment confirmed')).not.toBeInTheDocument()
  })

  test("another customer's order (404) shows the error state", async () => {
    apiFetch.mockRejectedValue(notFound())
    renderAt('/checkout/verify?order=999')
    await flush()
    expect(screen.getByText(/could not check this payment/i)).toBeInTheDocument()
  })
})
