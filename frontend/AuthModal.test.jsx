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
})
