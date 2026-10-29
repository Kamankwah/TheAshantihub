import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MoMoPayment } from '../../App.jsx'

// The wallet checkout assertions that lived here (wallet post, double click, insufficient funds, pickup note, ledger
// off, momo post, failed quote, zero total, pending/failed wallet read, staff notice, delivery-fee total) moved with
// the checkout to components/__tests__/CheckoutPage.test.jsx. What stays is MoMoPayment's own fee line, which App.jsx owns.

describe('MoMoPayment fee line', () => {
  function renderMomo(props) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={queryClient}>
        <MoMoPayment amount={300} purpose="AshantiHub Order Checkout" businessName="" onSuccess={vi.fn()} onClose={vi.fn()} {...props} />
      </QueryClientProvider>,
    )
  }

  it('test_momo_modal_has_no_made_up_fee_when_the_ledger_is_on', () => {
    const { container } = renderMomo({ processing: '4.50' })
    expect(screen.getByText('Payment processing')).toBeInTheDocument()
    expect(screen.getByText('GHS 4.50')).toBeInTheDocument()
    expect(screen.getByText('GHS 304.50')).toBeInTheDocument()
    expect(container.textContent).not.toContain('1.5%')
    expect(screen.getByText('MTN MoMo').parentElement).toHaveTextContent(/Dial \*170#$/)
    fireEvent.click(screen.getByText('MTN MoMo'))
    expect(container.textContent).not.toContain('1.5%')
    fireEvent.change(screen.getByPlaceholderText('0244 000 000'), { target: { value: '0244000000' } })
    expect(screen.getByText('Pay GHS 304.50 →')).toBeInTheDocument()
  })

  it('adds the server charge in whole pesewas', () => {
    renderMomo({ amount: 0.1, processing: '0.20' })
    expect(screen.getByText('GHS 0.30')).toBeInTheDocument()
  })

  it('test_momo_modal_keeps_the_simulated_fee_when_processing_is_undefined', () => {
    const { container } = renderMomo()
    expect(screen.getByText('Transaction fee (1.5%)')).toBeInTheDocument()
    expect(screen.getByText('GHS 4.50')).toBeInTheDocument()
    expect(screen.getByText('GHS 304.50')).toBeInTheDocument()
    expect(container.textContent).toContain('Dial *170# • 1.5% transaction fee')
  })
})
