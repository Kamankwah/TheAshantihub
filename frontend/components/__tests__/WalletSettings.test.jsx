import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../mocks/server.js'
import AccountHub from '../account/AccountHub.jsx'

const API = 'http://localhost:8000'
const addr = (o = {}) => ({
  id: 3, label: 'Home', recipient_name: 'Ama Mensah', phone: '0241234567', gps_address: 'AK-123-4567',
  landmark: 'Opposite the chemist', address_text: '', is_default: true, ...o,
})
function Loc() { return <div data-testid="loc">{useLocation().pathname}</div> }
function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/my-account/payments/settings']}>
        <AccountHub user={{ fullName: 'Ama', accountType: 'customer', id: 1 }} auth={{}} render={{}} onContactSupport={vi.fn()} />
        <Loc />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Your Payments > Settings tab', () => {
  it('test_shows_the_default_address_or_the_add_prompt', async () => {
    server.use(http.get(`${API}/api/accounts/addresses/`, () => HttpResponse.json([addr({ id: 4, is_default: false, gps_address: 'AK-999-0000' }), addr()])))
    const { unmount } = renderSettings()
    expect(await screen.findByText('Your default purchase preference')).toBeInTheDocument()
    expect(await screen.findByText('AK-123-4567')).toBeInTheDocument()
    expect(screen.queryByText('AK-999-0000')).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: 'Update' }))
    expect(screen.getByTestId('loc')).toHaveTextContent('/my-account/addresses')
    unmount()
    server.use(http.get(`${API}/api/accounts/addresses/`, () => HttpResponse.json([])))
    renderSettings()
    expect(await screen.findByText('No default address yet — add one')).toBeInTheDocument()
  })

  it('test_payment_method_line_says_it_is_chosen_at_checkout', async () => {
    renderSettings()
    expect(await screen.findByText('Not saved: you choose mobile money or your wallet at checkout.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Login & security' }))
    expect(screen.getByTestId('loc')).toHaveTextContent('/my-account/security')
  })

  it('test_no_default_payment_method_control', async () => {
    const { container } = renderSettings()
    await screen.findByText('Your default purchase preference')
    expect(container.querySelectorAll('input[type="radio"], input[type="checkbox"], select')).toHaveLength(0)
    expect(container.textContent).not.toMatch(/back-?up|set as default payment|edit payment/i)
  })
})
