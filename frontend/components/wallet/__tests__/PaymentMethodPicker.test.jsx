import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { server } from '../../../mocks/server.js'
import PaymentMethodPicker from '../PaymentMethodPicker.jsx'

const API = 'http://localhost:8000'

function Harness({ initial = 'momo', amount = '300.00' }) {
  const [value, setValue] = useState(initial)
  return <PaymentMethodPicker value={value} onChange={setValue} amount={amount} />
}

function renderPicker(props) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><Harness {...props} /></QueryClientProvider>)
}

const ledgerOff = () => http.get(`${API}/api/wallet/`, () => HttpResponse.json({ detail: "Wallets aren't switched on yet.", code: 'ledger_off' }, { status: 409 }))
const balance = (b) => http.get(`${API}/api/wallet/`, () => HttpResponse.json({ kind: 'customer', balance: b }))

describe('PaymentMethodPicker', () => {
  it('test_ledger_off_shows_only_mobile_money', async () => {
    server.use(ledgerOff())
    renderPicker()
    expect(await screen.findByRole('radio', { name: 'Mobile money' })).toBeChecked()
    expect(screen.queryByRole('radio', { name: /AshantiHub wallet/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/switched on/)).not.toBeInTheDocument()
  })

  it('test_wallet_option_shows_the_balance', async () => {
    server.use(balance('450.00'))
    renderPicker()
    const wallet = await screen.findByRole('radio', { name: /AshantiHub wallet/ })
    expect(wallet).toBeEnabled()
    expect(screen.getByText('GH₵ 450.00')).toBeInTheDocument()
  })

  it('test_wallet_disabled_when_balance_is_short', async () => {
    server.use(balance('120.50'))
    renderPicker({ amount: '300.00' })
    const wallet = await screen.findByRole('radio', { name: /AshantiHub wallet/ })
    expect(wallet).toBeDisabled()
    expect(screen.getByText(/Your balance is less than GH₵ 300.00/)).toBeInTheDocument()
  })

  it('test_processing_line_for_momo_only', async () => {
    server.use(
      balance('450.00'),
      http.get(`${API}/api/wallet/processing/`, () => HttpResponse.json({ amount: '300.00', payment_processing: '4.50', you_pay: '304.50', provider: 'simulated' })),
    )
    renderPicker()
    expect(await screen.findByTestId('processing-line')).toHaveTextContent('Payment processing GH₵ 4.50')
    expect(screen.getByTestId('processing-line')).toHaveTextContent('You pay GH₵ 304.50')
  })

  it('test_choosing_wallet_hides_the_processing_line', async () => {
    server.use(
      balance('450.00'),
      http.get(`${API}/api/wallet/processing/`, () => HttpResponse.json({ amount: '300.00', payment_processing: '4.50', you_pay: '304.50', provider: 'simulated' })),
    )
    renderPicker()
    await screen.findByTestId('processing-line')
    fireEvent.click(await screen.findByRole('radio', { name: /AshantiHub wallet/ }))
    expect(screen.getByRole('radio', { name: /AshantiHub wallet/ })).toBeChecked()
    expect(screen.queryByTestId('processing-line')).not.toBeInTheDocument()
  })
})
