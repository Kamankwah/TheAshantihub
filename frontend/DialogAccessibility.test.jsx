import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { axe } from 'jest-axe'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { server } from './mocks/server.js'
import { AuthModal, MoMoPayment } from './App.jsx'
import CartDrawer from './components/CartDrawer.jsx'

// Review FE-07: the sign-in modal and the cart are real dialogs: named, labelled, keyboard-contained, axe-clean.

const auth = { user: null, isLoading: false, login: vi.fn(), logout: vi.fn(), registerCustomer: vi.fn(), registerBusinessOwner: vi.fn() }
const wrap = (ui) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>

function Opener({ children }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && children(() => setOpen(false))}
    </>
  )
}

describe('AuthModal as a dialog', () => {
  it.each(['login', 'signup'])('has a name, labelled fields and no axe violations (%s)', async (state) => {
    const { container } = render(<AuthModal authState={state} auth={auth} onClose={vi.fn()} onSuccess={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName(state === 'login' ? 'Welcome back' : 'Create your account')
    for (const input of container.querySelectorAll('input:not([type=checkbox])')) expect(input).toHaveAccessibleName()
    expect(await axe(container)).toHaveNoViolations()
  }, 30000)

  it('autocompletes the credentials fields', () => {
    render(<AuthModal authState="login" auth={auth} onClose={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.getByLabelText('Phone or email')).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
  })

  it('moves focus in, keeps Tab inside, closes on Esc and gives focus back', async () => {
    const user = userEvent.setup()
    render(<Opener>{(close) => <AuthModal authState="login" auth={auth} onClose={close} onSuccess={vi.fn()} />}</Opener>)
    const opener = screen.getByRole('button', { name: 'Open' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toContainElement(document.activeElement)
    for (let i = 0; i < 25; i += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement)
    }
    await user.tab({ shift: true })
    expect(dialog).toContainElement(document.activeElement)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })
})

describe('CartDrawer as a dialog', () => {
  it('is a named dialog with no axe violations and closes on Esc', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json({ id: 1, items: [], total: '0.00' })))
    const onClose = vi.fn()
    const { container } = render(wrap(<CartDrawer onClose={onClose} onGoToCart={vi.fn()} />))
    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(screen.queryByText('Loading your cart…')).toBeNull())
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName(/Your Cart/)
    expect(await axe(container)).toHaveNoViolations()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('MoMoPayment as a dialog', () => {
  it('is a named dialog, axe-clean, and closes on Esc', async () => {
    const onClose = vi.fn()
    const { container } = render(wrap(<MoMoPayment amount={300} purpose="Order" businessName="" onSuccess={vi.fn()} onClose={onClose} processing="4.50" />))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAccessibleName('💰 Mobile Money Payment')
    expect(await axe(container)).toHaveNoViolations()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
