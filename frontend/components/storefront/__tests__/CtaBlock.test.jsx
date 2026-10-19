import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CtaBlock from '../CtaBlock.jsx'

describe('CtaBlock', () => {
  it('signed out: sign in opens the auth modal and sell opens registration', () => {
    const onSignIn = vi.fn()
    const onSell = vi.fn()
    render(<CtaBlock user={null} onSignIn={onSignIn} onSell={onSell} />)
    expect(screen.getByRole('heading', { name: 'Sign in for the best experience' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(onSignIn).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: 'Sell on AshantiHub' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Register your business' }))
    expect(onSell).toHaveBeenCalledTimes(1)
  })

  it('signed in: no sign-in prompt, selling stays', () => {
    render(<CtaBlock user={{ fullName: 'Ama', accountType: 'customer' }} onSignIn={() => {}} onSell={() => {}} />)
    expect(screen.queryByRole('heading', { name: 'Sign in for the best experience' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sell on AshantiHub' })).toBeInTheDocument()
  })
})
