import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthModal } from './App.jsx'
import { noteSignedOutReason } from './lib/signOutReason.js'

function makeAuth(overrides = {}) {
  return {
    user: null,
    isLoading: false,
    login: vi.fn().mockResolvedValue({ token: 't', account_type: 'customer', id: 1, full_name: 'Ama' }),
    logout: vi.fn(),
    registerCustomer: vi.fn().mockResolvedValue({ token: 't', account_type: 'customer', id: 1, full_name: 'Kofi' }),
    registerBusinessOwner: vi.fn().mockResolvedValue({ token: 't', account_type: 'business_owner', id: 1, full_name: 'Kofi', registration_step: 'business_info' }),
    ...overrides,
  }
}

describe('AuthModal', () => {
  it('submits identifier and password to auth.login on the Sign In form', async () => {
    const auth = makeAuth()
    const onSuccess = vi.fn()
    render(<AuthModal authState="login" auth={auth} onClose={vi.fn()} onSuccess={onSuccess} />)

    fireEvent.change(screen.getByPlaceholderText('Phone or email'), { target: { value: '+233241234567' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'secret' } })
    const signInButtons = screen.getAllByRole('button', { name: 'Sign In' })
    fireEvent.click(signInButtons[signInButtons.length - 1])

    await waitFor(() => expect(auth.login).toHaveBeenCalledWith('customer', '+233241234567', 'secret'))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
  })

  it('shows the customer signup form and submits to auth.registerCustomer', async () => {
    const auth = makeAuth()
    const onSuccess = vi.fn()
    render(<AuthModal authState="signup" auth={auth} onClose={vi.fn()} onSuccess={onSuccess} />)

    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Kofi Mensah' } })
    fireEvent.change(screen.getByPlaceholderText('Phone (+233...)'), { target: { value: '+233201112233' } })
    fireEvent.change(screen.getByPlaceholderText('Password (min 8 characters)'), { target: { value: 'secretpass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Free Account' }))

    await waitFor(() => expect(auth.registerCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ full_name: 'Kofi Mensah', phone: '+233201112233', password: 'secretpass' })
    ))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
  })

  it('signs up as a business owner via auth.registerBusinessOwner when that account type is chosen', async () => {
    const auth = makeAuth()
    const onSuccess = vi.fn()
    render(<AuthModal authState="signup" auth={auth} onClose={vi.fn()} onSuccess={onSuccess} />)

    fireEvent.click(screen.getByRole('button', { name: 'Business Owner' }))
    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Ama Owusu' } })
    fireEvent.change(screen.getByPlaceholderText('Phone (+233...)'), { target: { value: '+233201112233' } })
    fireEvent.change(screen.getByPlaceholderText('Password (min 8 characters)'), { target: { value: 'secretpass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Business Account' }))

    await waitFor(() => expect(auth.registerBusinessOwner).toHaveBeenCalledWith(
      expect.objectContaining({ full_name: 'Ama Owusu', login_phone: '+233201112233', password: 'secretpass' })
    ))
    expect(auth.registerCustomer).not.toHaveBeenCalled()
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
  })

  it('shows an error message and does not call onSuccess when login fails', async () => {
    const auth = makeAuth({ login: vi.fn().mockRejectedValue(new Error('API request failed with status 400')) })
    const onSuccess = vi.fn()
    render(<AuthModal authState="login" auth={auth} onClose={vi.fn()} onSuccess={onSuccess} />)

    fireEvent.change(screen.getByPlaceholderText('Phone or email'), { target: { value: '+233241234567' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrong' } })
    const signInButtons = screen.getAllByRole('button', { name: 'Sign In' })
    fireEvent.click(signInButtons[signInButtons.length - 1])

    await waitFor(() => expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument())
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('locks to staff login and hides the signup tab when authState is staff-login', () => {
    render(<AuthModal authState="staff-login" auth={makeAuth()} onClose={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Sign Up' })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Phone or email')).toBeInTheDocument()
  })

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn()
    render(<AuthModal authState="login" auth={makeAuth()} onClose={onClose} onSuccess={vi.fn()} />)
    fireEvent.click(screen.getByTestId('auth-modal-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows an error and does not call auth.registerCustomer when both phone and email are left blank', async () => {
    const auth = makeAuth()
    render(<AuthModal authState="signup" auth={auth} onClose={vi.fn()} onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Kofi Mensah' } })
    fireEvent.change(screen.getByPlaceholderText('Password (min 8 characters)'), { target: { value: 'secretpass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Free Account' }))

    await waitFor(() => expect(screen.getByText('Please provide a phone number or email address.')).toBeInTheDocument())
    expect(auth.registerCustomer).not.toHaveBeenCalled()
  })

  it('login mode still offers the Customer/Business Owner account-type toggle', async () => {
    const auth = makeAuth()
    render(<AuthModal authState="login" auth={auth} onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Business Owner' }))
    fireEvent.change(screen.getByPlaceholderText('Phone or email'), { target: { value: '+233241234567' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'secret' } })
    const signInButtons = screen.getAllByRole('button', { name: 'Sign In' })
    fireEvent.click(signInButtons[signInButtons.length - 1])
    await waitFor(() => expect(auth.login).toHaveBeenCalledWith('business_owner', '+233241234567', 'secret'))
  })

  // The /staff sign-in can't be dismissed into the marketplace, so a visitor
  // who landed there by mistake gets one plain way out.
  it('offers a "Go to marketplace" link on the staff sign-in only when onGoToMarketplace is given', () => {
    const onGoToMarketplace = vi.fn()
    const { unmount } = render(<AuthModal authState="staff-login" auth={makeAuth()} onClose={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Go to marketplace' })).not.toBeInTheDocument()
    unmount()

    render(<AuthModal authState="staff-login" auth={makeAuth()} onClose={vi.fn()} onSuccess={vi.fn()} onGoToMarketplace={onGoToMarketplace} />)
    fireEvent.click(screen.getByRole('button', { name: 'Go to marketplace' }))
    expect(onGoToMarketplace).toHaveBeenCalledTimes(1)
  })

  it('never shows "Go to marketplace" on the customer/business sign-in', () => {
    render(<AuthModal authState="login" auth={makeAuth()} onClose={vi.fn()} onSuccess={vi.fn()} onGoToMarketplace={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Go to marketplace' })).not.toBeInTheDocument()
  })
})

describe('AuthModal — signed-out notice', () => {
  it('the staff sign-in explains an idle sign-out, once', () => {
    noteSignedOutReason('idle')
    const { unmount } = render(<AuthModal authState="staff-login" auth={makeAuth()} onClose={() => {}} onSuccess={() => {}} />)
    expect(screen.getByText('You were signed out after 30 minutes without activity.')).toBeInTheDocument()
    unmount()
    render(<AuthModal authState="staff-login" auth={makeAuth()} onClose={() => {}} onSuccess={() => {}} />)
    expect(screen.queryByText('You were signed out after 30 minutes without activity.')).not.toBeInTheDocument()
  })

  it('returns to the password with a notice when the 2-step step has timed out', async () => {
    const expired = Object.assign(new Error('400'), { status: 400, body: { detail: 'Your sign-in timed out. Enter your password again.', code: 'challenge_expired' } })
    const auth = makeAuth({
      login: vi.fn().mockResolvedValue({ two_factor_required: true, mfa_token: 'mfa' }),
      verifyTwoFactor: vi.fn().mockRejectedValue(expired),
    })
    render(<AuthModal authState="staff-login" auth={auth} onClose={() => {}} onSuccess={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('Phone or email'), { target: { value: 'boss@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'secret' } })
    const buttons = screen.getAllByRole('button', { name: 'Sign In' })
    fireEvent.click(buttons[buttons.length - 1])
    fireEvent.change(await screen.findByLabelText('6-digit code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Your sign-in timed out. Enter your password again.')
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument()
  })
})

