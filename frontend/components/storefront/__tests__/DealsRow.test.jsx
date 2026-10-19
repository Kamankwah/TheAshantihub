import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import { DEALS, DEALS_URL, json } from '../../../mocks/storefront.js'
import DealsRow from '../DealsRow.jsx'

function renderWithClient(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const card = (name) => screen.getByText(name).closest('[data-deal]')

describe('DealsRow', () => {
  it('shows_was_price_only_when_present', async () => {
    server.use(json(DEALS_URL, DEALS))
    const onOpen = vi.fn()
    renderWithClient(<DealsRow onOpen={onOpen} />)
    await screen.findByText('Kente stole')

    const stole = card('Kente stole')
    expect(within(stole).getByText('GH₵ 80.00')).toBeInTheDocument()
    const was = stole.querySelector('s')
    expect(was).toHaveTextContent('GH₵ 100.00')
    expect(within(stole).getByText('20% off')).toBeInTheDocument()

    // A sale without a real 7-day "was" price: the sale price alone. The
    // regular price_amount is never struck through or shown.
    const shea = card('Shea butter')
    expect(within(shea).getByText('GH₵ 50.00')).toBeInTheDocument()
    expect(shea.querySelector('s')).toBeNull()
    expect(within(shea).queryByText('GH₵ 70.00')).not.toBeInTheDocument()
    expect(within(shea).queryByText(/% off/)).not.toBeInTheDocument()

    fireEvent.click(within(stole).getByRole('button'))
    expect(onOpen).toHaveBeenCalledWith(101)
  })

  it('labels_sponsored', async () => {
    server.use(json(DEALS_URL, DEALS))
    renderWithClient(<DealsRow onOpen={() => {}} />)
    await screen.findByText('Clay pot')
    const pot = card('Clay pot')
    expect(within(pot).getByText('Sponsored')).toBeInTheDocument()
    expect(within(pot).getByText('GH₵ 30.00')).toBeInTheDocument()
    expect(within(card('Kente stole')).queryByText('Sponsored')).not.toBeInTheDocument()
  })

  it('hidden_when_empty', async () => {
    let asked = false
    server.use(http.get(DEALS_URL, () => { asked = true; return HttpResponse.json([]) }))
    const { container } = renderWithClient(<DealsRow onOpen={() => {}} />)
    await waitFor(() => expect(asked).toBe(true))
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
  })

  it('hides itself when the feed fails', async () => {
    let asked = false
    server.use(http.get(DEALS_URL, () => { asked = true; return HttpResponse.json({}, { status: 500 }) }))
    const { container } = renderWithClient(<DealsRow onOpen={() => {}} />)
    await waitFor(() => expect(asked).toBe(true))
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
  })
})
