import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import { OPENING_URL } from '../../../mocks/opening.js'
import { BANNERS_URL, flashBanner } from '../../../mocks/storefront.js'
import FlashStrip from '../FlashStrip.jsx'

function renderWithClient(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

// The server's clock is set months behind this device's: a countdown read off
// the device clock would already be over and show nothing.
const SERVER_NOW = '2026-01-10T08:00:00Z'
const serverClock = http.get(OPENING_URL, () => HttpResponse.json({
  opens_at: '2026-01-01T06:00:00Z', server_now: SERVER_NOW, is_open: true, gate_enabled: false,
}))

describe('FlashStrip', () => {
  it('counts_down_from_server_time', async () => {
    const ends = new Date(Date.parse(SERVER_NOW) + ((1 * 60 + 2) * 60 + 3) * 1000).toISOString()
    server.use(serverClock, flashBanner({ countdown_ends_at: ends, link_path: '/business?category=clothing' }))
    const onNavigate = vi.fn()
    renderWithClient(<FlashStrip onNavigate={onNavigate} />)
    expect(await screen.findByText('Kente week: 20% off woven stoles')).toBeInTheDocument()
    const timer = await screen.findByTestId('flash-countdown')
    expect(timer.textContent).toMatch(/^Ends in 01:02:0[0-3]$/)
    fireEvent.click(screen.getByRole('button', { name: /Kente week/ }))
    expect(onNavigate).toHaveBeenCalledWith('/business?category=clothing')
  })

  it('shows the message alone when the banner has no countdown', async () => {
    server.use(serverClock, flashBanner())
    renderWithClient(<FlashStrip onNavigate={() => {}} />)
    expect(await screen.findByText('Kente week: 20% off woven stoles')).toBeInTheDocument()
    expect(screen.queryByTestId('flash-countdown')).not.toBeInTheDocument()
  })

  it('hidden_when_no_live_banner', async () => {
    let asked = false
    server.use(http.get(BANNERS_URL, () => { asked = true; return HttpResponse.json({ banners: [] }) }))
    const { container } = renderWithClient(<FlashStrip onNavigate={() => {}} />)
    await waitFor(() => expect(asked).toBe(true))
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
  })
})
