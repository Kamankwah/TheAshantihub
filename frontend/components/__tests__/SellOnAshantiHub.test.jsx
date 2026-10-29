import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import BusinessRegistrationFlow from '../BusinessRegistrationFlow.jsx'
import SellOnAshantiHub from '../account/SellOnAshantiHub.jsx'

const user = { fullName: 'Ama Boateng', accountType: 'customer', id: 1, email: 'ama@example.com', phone: '0244000111' }

function renderSell(props = {}) {
  return render(<SellOnAshantiHub user={user} auth={{}} onStart={vi.fn()} {...props} />)
}

describe('SellOnAshantiHub', () => {
  it('test_welcome_shows_the_customers_name_email_and_phone', () => {
    renderSell()
    expect(screen.getByRole('heading', { name: 'Welcome, Ama Boateng' })).toBeInTheDocument()
    expect(screen.getByText('ama@example.com')).toBeInTheDocument()
    expect(screen.getByText('0244000111')).toBeInTheDocument()
  })

  it('test_use_my_details_opens_registration_prefilled', () => {
    const onStart = vi.fn()
    renderSell({ onStart })
    fireEvent.click(screen.getByRole('button', { name: 'Use my details' }))
    expect(onStart).toHaveBeenCalledWith({ full_name: 'Ama Boateng', phone: '0244000111', email: 'ama@example.com' })
  })

  it('test_start_fresh_opens_registration_empty', () => {
    const onStart = vi.fn()
    renderSell({ onStart })
    fireEvent.click(screen.getByRole('button', { name: 'Start with different details' }))
    expect(onStart).toHaveBeenCalledWith(null)
  })

  it('test_separate_login_line_is_shown', () => {
    renderSell()
    expect(screen.getByText('This creates a separate business login.')).toBeInTheDocument()
  })

  it('lists only real features and no business contact route', () => {
    renderSell()
    expect(screen.getByRole('heading', { name: 'Why sell on AshantiHub' })).toBeInTheDocument()
    expect(screen.getByText(/shoppers across the Ashanti region/i)).toBeInTheDocument()
    expect(screen.getByText('A verified check mark once AshantiHub staff approve your Ghana Card.')).toBeInTheDocument()
    expect(screen.queryByText(/KYC/)).not.toBeInTheDocument()
    expect(screen.getByText(/mobile money or bank/i)).toBeInTheDocument()
  })

  it('tolerates a customer with no email or phone', () => {
    renderSell({ user: { fullName: 'Kofi', accountType: 'customer', id: 2 } })
    fireEvent.click(screen.getByRole('button', { name: 'Use my details' }))
    expect(screen.getByRole('heading', { name: 'Welcome, Kofi' })).toBeInTheDocument()
  })

  function renderFlow(auth, prefill) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><BusinessRegistrationFlow user={null} auth={auth} prefill={prefill} setPage={vi.fn()} setShowBizDash={vi.fn()} /></MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('test_duplicate_contact_server_message_is_displayed', async () => {
    const err = Object.assign(new Error('400'), { status: 400, body: { login_phone: ['A business account with this phone number already exists.'] } })
    const auth = { registerBusinessOwner: vi.fn().mockRejectedValue(err), logout: vi.fn() }
    renderFlow(auth, { full_name: 'Ama Boateng', phone: '0244000111', email: 'ama@example.com' })
    fireEvent.change(screen.getByPlaceholderText(/Password/), { target: { value: 'longenough1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('A business account with this phone number already exists.')).toBeInTheDocument()
  })

  it('seeds the personal info fields from the prefill', () => {
    renderFlow({ logout: vi.fn() }, { full_name: 'Ama Boateng', phone: '0244000111', email: 'ama@example.com' })
    expect(screen.getByPlaceholderText('Full name')).toHaveValue('Ama Boateng')
    expect(screen.getByPlaceholderText(/Phone/)).toHaveValue('0244000111')
    expect(screen.getByPlaceholderText('Email')).toHaveValue('ama@example.com')
  })

  it('test_self_registration_path_still_reaches_the_personal_info_step', () => {
    renderFlow({ logout: vi.fn() }, undefined)
    expect(screen.getByText(/1 of 5: Personal Information/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Full name')).toHaveValue('')
    expect(screen.getByPlaceholderText(/Phone/)).toHaveValue('')
  })
})
