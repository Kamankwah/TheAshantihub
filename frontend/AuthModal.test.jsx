import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthModal } from './App.jsx'

function makeAuth(overrides = {}) {
  return {
    user: null,
    isLoading: false,
    login: vi.fn().mockResolvedValue({ token: 't', account_type: 'customer', id: 1, full_name: 'Ama' }),
    logout: vi.fn(),
    registerCustomer: vi.fn().mockResolvedValue({ token: 't', account_type: 'customer', id: 1, full_name: 'Kofi' }),
    registerBusinessOwner: vi.fn().mockResolvedValue({ token: 't', account_type: 'business_owner', id: 2, full_name: 'Abena' }),
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

  it('defaults to the customer signup form and submits to auth.registerCustomer', async () => {
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

  it('switches to the business owner signup form and shows KYC fields', () => {
    render(<AuthModal authState="signup" auth={makeAuth()} onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: "I'm a Business Owner" }))
    expect(screen.getByPlaceholderText('Ghana Card number')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('GPS address (e.g. AK-123-4567)')).toBeInTheDocument()
  })

  it('reveals business registration certificate and TIN fields only when is_formal is checked', () => {
    render(<AuthModal authState="signup" auth={makeAuth()} onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: "I'm a Business Owner" }))
    expect(screen.queryByPlaceholderText('TIN')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/formally registered/i))
    expect(screen.getByPlaceholderText('TIN')).toBeInTheDocument()
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

  it('locks to staff login and hides the signup/account-type tabs when authState is staff-login', () => {
    render(<AuthModal authState="staff-login" auth={makeAuth()} onClose={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Sign Up' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: "I'm a Business Owner" })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Phone or email')).toBeInTheDocument()
  })

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn()
    render(<AuthModal authState="login" auth={makeAuth()} onClose={onClose} onSuccess={vi.fn()} />)
    fireEvent.click(screen.getByTestId('auth-modal-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })

  it('blocks business-owner signup via native validation when the default momo payout method has no momo number', async () => {
    const auth = makeAuth()
    render(<AuthModal authState="signup" auth={auth} onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: "I'm a Business Owner" }))

    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Abena Owusu' } })
    fireEvent.change(screen.getByPlaceholderText('Login phone (+233...)'), { target: { value: '+233201112233' } })
    fireEvent.change(screen.getByPlaceholderText('Password (min 8 characters)'), { target: { value: 'secretpass' } })
    fireEvent.change(screen.getByPlaceholderText('Ghana Card number'), { target: { value: 'GHA-000000000-0' } })
    fireEvent.change(screen.getByPlaceholderText('GPS address (e.g. AK-123-4567)'), { target: { value: 'AK-123-4567' } })
    fireEvent.change(screen.getByPlaceholderText('Business contact phone (public)'), { target: { value: '+233201112233' } })

    // default_payout_method defaults to "momo" and payout_momo_number is left blank.
    const momoInput = screen.getByPlaceholderText('Mobile money number')
    expect(momoInput).toHaveAttribute('required')
    expect(momoInput.validity.valid).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Submit for Verification' }))

    expect(auth.registerBusinessOwner).not.toHaveBeenCalled()
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
})
