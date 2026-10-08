import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import StaffTwoStepSignIn from '../StaffTwoStepSignIn.jsx'

const signedIn = { token: 't', account_type: 'staff', id: 1, full_name: 'Simon Peter', role: 'super_admin' }

describe('StaffTwoStepSignIn', () => {
  it('signs in with the code from the app', async () => {
    const auth = { verifyTwoFactor: vi.fn(async () => signedIn) }
    const onSuccess = vi.fn()
    render(<StaffTwoStepSignIn challenge={{ two_factor_required: true, mfa_token: 'mfa' }} auth={auth} onSuccess={onSuccess} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(signedIn))
    expect(auth.verifyTwoFactor).toHaveBeenCalledWith('mfa', { code: '123456' })
  })

  it('can use a recovery code instead, and shows a wrong code inline', async () => {
    const auth = { verifyTwoFactor: vi.fn(async () => { throw Object.assign(new Error('400'), { status: 400, body: { detail: "That code isn't right. Check your authenticator app and try again." } }) }) }
    render(<StaffTwoStepSignIn challenge={{ two_factor_required: true, mfa_token: 'mfa' }} auth={auth} onSuccess={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Lost your phone? Use a recovery code' }))
    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: 'abcde-fghjk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("That code isn't right.")
    expect(auth.verifyTwoFactor).toHaveBeenCalledWith('mfa', { recoveryCode: 'abcde-fghjk' })
  })

  it('walks a Super Admin through setting it up, then shows the recovery codes once', async () => {
    const codes = Array.from({ length: 10 }, (_, i) => `code${i}-xxxxx`)
    const auth = {
      startTwoFactorEnrolment: vi.fn(async () => ({ secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/AshantiHub:boss%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=AshantiHub' })),
      confirmTwoFactorEnrolment: vi.fn(async () => ({ recoveryCodes: codes, login: { token: 't' } })),
      completeSignIn: vi.fn(async () => signedIn),
    }
    const onSuccess = vi.fn()
    render(<StaffTwoStepSignIn challenge={{ two_factor_setup_required: true, mfa_token: 'mfa' }} auth={auth} onSuccess={onSuccess} onCancel={() => {}} />)
    expect(await screen.findByLabelText('Setup key')).toHaveTextContent('JBSW Y3DP EHPK 3PXP')
    fireEvent.change(screen.getByLabelText('6-digit code from the app'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Turn on 2-step sign-in' }))
    expect(await screen.findByRole('list', { name: 'Recovery codes' })).toHaveTextContent('code0-xxxxx')
    const next = screen.getByRole('button', { name: 'Continue to the dashboard' })
    expect(next).toBeDisabled()
    fireEvent.click(screen.getByLabelText("I've saved these codes"))
    fireEvent.click(next)
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(signedIn))
    expect(auth.completeSignIn).toHaveBeenCalledWith({ token: 't' })
  })

  it('strips spaces from the code and sends it as a string', async () => {
    const auth = { verifyTwoFactor: vi.fn(async () => signedIn) }
    render(<StaffTwoStepSignIn challenge={{ two_factor_required: true, mfa_token: 'mfa' }} auth={auth} onSuccess={() => {}} onCancel={() => {}} />)
    const input = screen.getByLabelText('6-digit code')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('autocomplete', 'one-time-code')
    expect(input).toHaveAttribute('maxlength')
    fireEvent.change(input, { target: { value: '123 456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(auth.verifyTwoFactor).toHaveBeenCalledWith('mfa', { code: '123456' }))
  })

  it('disables Sign in while the code is being checked', async () => {
    let release
    const auth = { verifyTwoFactor: vi.fn(() => new Promise((r) => { release = r })) }
    render(<StaffTwoStepSignIn challenge={{ two_factor_required: true, mfa_token: 'mfa' }} auth={auth} onSuccess={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Checking…' }))
    expect(auth.verifyTwoFactor).toHaveBeenCalledTimes(1)
    release(signedIn)
  })

  it('shows a refusal from enrolment start as an alert', async () => {
    const auth = { startTwoFactorEnrolment: vi.fn(async () => { throw Object.assign(new Error('400'), { status: 400, body: { detail: 'That sign-in has expired. Sign in again.' } }) }) }
    render(<StaffTwoStepSignIn challenge={{ two_factor_setup_required: true, mfa_token: 'mfa' }} auth={auth} onSuccess={() => {}} onCancel={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('That sign-in has expired.')
  })
})

