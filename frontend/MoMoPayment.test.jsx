import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MoMoPayment } from './App.jsx'

// Regression tests for the simulated-payment success callback (punch-list
// item 12): a cleanup added in eb7587d cleared the 1s onSuccess timeout from
// the same effect whose deps include `success` — so setSuccess(true) itself
// re-ran the effect and the cleanup cancelled the just-scheduled timeout,
// meaning onSuccess never fired for ANY simulated payment (events stuck on
// "Pay to publish", orders never placed). These tests drive the full
// select-network → enter-phone → pay → countdown flow with fake timers and
// assert onSuccess actually reaches the caller — and that closing the modal
// mid-window still cancels it (the intent eb7587d was after).

function renderPayment(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MoMoPayment
        amount={30}
        purpose="Event visibility payment"
        businessName="Ama Owusu"
        onSuccess={vi.fn()}
        onClose={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  )
}

// Drives the modal from step 1 to step 3 (the simulated processing screen).
// Fake timers are installed *before* the final "Pay" click (same convention
// as BusinessDashboard.test.jsx's hero-extend test) so the countdown
// interval is created on the fake clock rather than the real one.
function payThrough() {
  fireEvent.click(screen.getByText('MTN MoMo'))
  fireEvent.change(screen.getByPlaceholderText('0244 000 000'), { target: { value: '0244000000' } })
  vi.useFakeTimers({ shouldAdvanceTime: true })
  fireEvent.click(screen.getByText(/^Pay GHS/))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('MoMoPayment simulated flow', () => {
  it('calls onSuccess after the countdown + 1s success pause', async () => {
    const onSuccess = vi.fn()
    renderPayment({ onSuccess })
    payThrough()
    expect(screen.getByText('Processing Payment...')).toBeInTheDocument()

    // 30 ticks x 100ms = 3s countdown, then the success receipt appears...
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    expect(screen.getByText('Payment Successful!')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
    // ...and 1s later onSuccess reaches the caller.
    await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('does not call onSuccess when the modal is closed during the 1s window', async () => {
    const onSuccess = vi.fn()
    const { unmount } = renderPayment({ onSuccess })
    payThrough()

    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    expect(onSuccess).not.toHaveBeenCalled()
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
