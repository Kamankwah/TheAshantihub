import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import BookingTermsNote from '../BookingTermsNote.jsx'

const mount = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const NOW = new Date('2026-10-01T09:00:00Z')

describe('BookingTermsNote', () => {
  it('shows nothing for a product', async () => {
    const { container } = mount(<BookingTermsNote kind="product" policy="flexible" now={NOW} />)
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
  })

  it('tells a flexible stay guest the exact free-cancellation time and when the host is paid', async () => {
    mount(<BookingTermsNote kind="stay" policy="flexible" start={new Date('2026-10-10T14:00:00Z')} now={NOW} />)
    expect(await screen.findByText('Free cancellation until Fri 9 Oct, 14:00')).toBeInTheDocument()
    expect(screen.getByText(/The host is paid 24 hours after check-in time, on Sun 11 Oct, 14:00/)).toBeInTheDocument()
  })

  it('lists each step of a moderate policy', async () => {
    mount(<BookingTermsNote kind="stay" policy="moderate" start={new Date('2026-10-10T14:00:00Z')} now={NOW} />)
    expect(await screen.findByText('Free cancellation until Mon 5 Oct, 14:00')).toBeInTheDocument()
    expect(screen.getByText('50% refund until Fri 9 Oct, 14:00')).toBeInTheDocument()
  })

  it('says so when a strict stay has no refund left', async () => {
    mount(<BookingTermsNote kind="stay" policy="strict" start={new Date('2026-10-03T14:00:00Z')} now={NOW} />)
    expect(await screen.findByText('No refund if you cancel now')).toBeInTheDocument()
  })

  it('follows the governed hours, not a fixed number', async () => {
    mount(<BookingTermsNote kind="service" policy="flexible" now={NOW} />)
    expect(await screen.findByText(/Cancel for a full refund any time before the business marks the job done/)).toBeInTheDocument()
    expect(screen.getByText(/accepted automatically 48 hours after the business marks it done/)).toBeInTheDocument()
  })

  it('tickets without a refund window have no refund after purchase', async () => {
    mount(<BookingTermsNote kind="ticket" refundDays={null} start={new Date('2026-10-20T18:00:00Z')} now={NOW} />)
    expect(await screen.findByText('No refund after purchase')).toBeInTheDocument()
    expect(screen.getByText(/refunded in full if the event is cancelled/i)).toBeInTheDocument()
    expect(screen.getByText(/The organiser is paid 48 hours after the event day ends/)).toBeInTheDocument()
  })

  it('tickets with a refund window show the exact cut-off', async () => {
    mount(<BookingTermsNote kind="ticket" refundDays={3} start={new Date('2026-10-20T18:00:00Z')} now={NOW} />)
    expect(await screen.findByText('Free cancellation until Sat 17 Oct, 18:00')).toBeInTheDocument()
  })
})
