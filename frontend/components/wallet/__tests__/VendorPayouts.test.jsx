import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setStepUpHandler } from '../../../apiClient.js'
import { server } from '../../../mocks/server.js'
import VendorPayouts from '../VendorPayouts.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}
const vendorWallet = (over = {}) => {
  server.use(
    http.get(`${API}/api/wallet/`, () => HttpResponse.json({ kind: 'vendor', pending: '12.00', available: '48.50' })),
    http.get(`${API}/api/wallet/vendor/`, () => HttpResponse.json({
      pending: '12.00', available: '48.50', withdrawable: '48.50', negative: false, awaiting_call: false, fee_cap: '0.00', ...over,
    })),
  )
}
let unregister = null
afterEach(() => {
  if (unregister) unregister()
  unregister = null
  vi.restoreAllMocks()
})

describe('VendorPayouts', () => {
  it('test_shows_pending_and_available', async () => {
    vendorWallet()
    wrap(<VendorPayouts />)
    expect(await screen.findByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Available')).toBeInTheDocument()
    expect(screen.getByText(/48\.50/)).toBeInTheDocument()
    expect(screen.getByText(/12\.00/)).toBeInTheDocument()
    expect(screen.getByText(/payout number whose account name matches your registered name/i)).toBeInTheDocument()
  })

  it('test_negative_available_blocks_the_form_copy', async () => {
    vendorWallet({ negative: true })
    wrap(<VendorPayouts />)
    expect(await screen.findByText(/withdrawals wait until it is recovered/i)).toBeInTheDocument()
  })

  it('test_registered_details_button_posts_from_profile_through_step_up', async () => {
    vendorWallet()
    const seen = []
    server.use(http.post(`${API}/api/wallet/destinations/`, async ({ request }) => {
      if (!request.headers.get('X-Step-Up-Token')) {
        return HttpResponse.json({ detail: 'Enter a code.', code: 'step_up_required', action: 'destination' }, { status: 403 })
      }
      seen.push(await request.json())
      return HttpResponse.json({ id: 3, rail: 'momo', institution: 'MTN', account_name: 'Akosua', account_number_masked: '024****567', usable_from: null, usable: false, removed: false }, { status: 201 })
    }))
    const handler = vi.fn().mockResolvedValue({ token: 'abc', expiresIn: 300 })
    unregister = setStepUpHandler(handler)
    wrap(<VendorPayouts />)
    fireEvent.click(await screen.findByRole('button', { name: 'Use my registered payout details' }))
    await waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toEqual({ from_profile: true })
    expect(handler).toHaveBeenCalled()
  })

  it('test_withdraw_uses_the_vendor_base_path_default', async () => {
    vendorWallet()
    const bodies = []
    server.use(
      http.get(`${API}/api/wallet/destinations/`, () => HttpResponse.json({
        results: [{ id: 7, rail: 'momo', institution: 'MTN', account_name: 'Akosua', account_number_masked: '024****567', usable_from: '2026-10-01T10:00:00Z', usable: true, removed: false }],
        cooling_hours: 24,
      })),
      http.post(`${API}/api/wallet/withdrawals/`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ id: 1, reference: 'WD-1', amount: '10.00', charge: '0.00', you_receive: '10.00', status: 'processing', status_label: 'Processing', destination: null, created_at: '2026-10-20T10:05:00Z', settled_at: null, failure_reason: '' }, { status: 201 })
      }),
    )
    wrap(<VendorPayouts />)
    const amount = await screen.findByLabelText(/amount to withdraw/i)
    fireEvent.change(amount, { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: /withdraw/i }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ destination: 7, amount: '10' })
  })

  it('test_ledger_off_shows_one_line', async () => {
    server.use(
      http.get(`${API}/api/wallet/`, () => HttpResponse.json({ detail: 'Wallets are not switched on yet.', code: 'ledger_off' }, { status: 409 })),
      http.get(`${API}/api/wallet/destinations/`, () => HttpResponse.json({ detail: 'off', code: 'ledger_off' }, { status: 409 })),
      http.get(`${API}/api/wallet/transactions/`, () => HttpResponse.json({ detail: 'off', code: 'ledger_off' }, { status: 409 })),
      http.get(`${API}/api/wallet/withdrawals/`, () => HttpResponse.json({ detail: 'off', code: 'ledger_off' }, { status: 409 })),
    )
    wrap(<VendorPayouts />)
    await screen.findByText(/not switched on|not available|switched on/i)
    expect(screen.queryByText('Pending')).toBeNull()
    expect(screen.queryByRole('button', { name: /registered payout details/i })).toBeNull()
    expect(screen.queryByLabelText(/amount to withdraw/i)).toBeNull()
    expect(screen.queryByText(/payout number whose account name/i)).toBeNull()
  })

  it('test_no_cap_meter_or_export_controls', async () => {
    vendorWallet()
    wrap(<VendorPayouts />)
    await screen.findByText('Pending')
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByText(/cap/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /export|download|csv/i })).toBeNull()
  })

  it('test_a_failed_withdraw_then_retry_sends_the_same_request_id', async () => {
    vendorWallet()
    const bodies = []
    server.use(
      http.get(`${API}/api/wallet/destinations/`, () => HttpResponse.json({
        results: [{ id: 7, rail: 'momo', institution: 'MTN', account_name: 'Akosua', account_number_masked: '024****567', usable_from: '2026-10-01T10:00:00Z', usable: true, removed: false }],
        cooling_hours: 24,
      })),
      http.post(`${API}/api/wallet/withdrawals/`, async ({ request }) => {
        bodies.push(await request.json())
        if (bodies.length === 1) return HttpResponse.json({ detail: 'Try again.' }, { status: 500 })
        return HttpResponse.json({ id: 1, reference: 'WD-1', amount: '10.00', charge: '0.00', you_receive: '10.00', status: 'processing', status_label: 'Processing', destination: null, created_at: '2026-10-20T10:05:00Z', settled_at: null, failure_reason: '' }, { status: 201 })
      }),
    )
    wrap(<VendorPayouts />)
    fireEvent.change(await screen.findByLabelText(/amount to withdraw/i), { target: { value: '10' } })
    const go = () => fireEvent.click(screen.getByRole('button', { name: /withdraw/i }))
    go()
    await screen.findByRole('alert')
    await waitFor(() => expect(screen.getByRole('button', { name: /withdraw/i })).not.toBeDisabled())
    go()
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[0].request_id).toBeTruthy()
    expect(bodies[1].request_id).toBe(bodies[0].request_id)
  })
})
