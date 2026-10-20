import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OtpSignIn from '../OtpSignIn.jsx'

const channels = [
  { channel: 'sms', hint: 'Text a code to 0•• ••• 1234' },
  { channel: 'email', hint: 'Email a code to a•••@x.com' },
]
const challenge = { otp_required: true, mfa_token: 'mfa', channels }
const signedIn = { token: 't', account_type: 'customer', id: 1, full_name: 'Ama' }
const fail = (status, body) => Object.assign(new Error(String(status)), { status, body })

function setup({ auth = {}, ch = challenge, accountType = 'customer', purpose = 'sign_in' } = {}) {
  const fake = {
    sendOtpCode: vi.fn(async (_t, channel) => ({ channel, hint: channels.find((c) => c.channel === channel)?.hint, expires_in: 300, resend_in: 60 })),
    verifyOtp: vi.fn(async () => signedIn),
    ...auth,
  }
  const onSuccess = vi.fn()
  const onCancel = vi.fn()
  render(<OtpSignIn challenge={ch} accountType={accountType} purpose={purpose} auth={fake} onSuccess={onSuccess} onCancel={onCancel} />)
  return { auth: fake, onSuccess, onCancel }
}

const choose = async (name) => {
  fireEvent.click(screen.getByRole('button', { name }))
  return screen.findByLabelText('6-digit code')
}
const SMS = 'Text a code to 0•• ••• 1234'

afterEach(() => { vi.useRealTimers(); localStorage.clear(); sessionStorage.clear() })

describe('OtpSignIn', () => {
  it('lists each channel with the server hint and sends nothing until chosen', () => {
    const { auth } = setup()
    expect(screen.getByRole('button', { name: SMS })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Email a code to a•••@x.com' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: SMS })).toHaveFocus()
    expect(auth.sendOtpCode).not.toHaveBeenCalled()
  })

  it('sends on the chosen channel and shows the code field', async () => {
    const { auth } = setup()
    const input = await choose('Email a code to a•••@x.com')
    expect(auth.sendOtpCode).toHaveBeenCalledWith('mfa', 'email')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('autocomplete', 'one-time-code')
    expect(input).toHaveAttribute('maxlength', '7')
    await waitFor(() => expect(input).toHaveFocus())
    expect(screen.getByRole('status')).toHaveTextContent('We sent a code to a•••@x.com.')
  })

  it('signs in with the typed code (spaces stripped) and clears the field', async () => {
    const { auth, onSuccess } = setup()
    const input = await choose(SMS)
    fireEvent.change(input, { target: { value: '123 456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(signedIn))
    expect(auth.verifyOtp).toHaveBeenCalledWith('mfa', { code: '123456', trustDevice: false })
    expect(input).toHaveValue('')
  })

  it('says Confirm for sign-up and passes the registration kind', async () => {
    const { auth, onSuccess } = setup({ accountType: 'business_owner', purpose: 'sign_up' })
    const input = await choose(SMS)
    fireEvent.change(input, { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(auth.verifyOtp).toHaveBeenCalledWith('mfa', { code: '654321', trustDevice: false, registration: 'business_owner' })
  })

  it('passes trustDevice only when ticked and only for customers', async () => {
    const { auth, onSuccess } = setup()
    const input = await choose(SMS)
    expect(screen.getByLabelText('Trust this device. It will skip the code for a while.')).not.toBeChecked()
    fireEvent.click(screen.getByLabelText('Trust this device. It will skip the code for a while.'))
    fireEvent.change(input, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(auth.verifyOtp).toHaveBeenCalledWith('mfa', { code: '123456', trustDevice: true })
  })

  it.each(['business_owner', 'staff'])('a %s never sees the trust checkbox', async (accountType) => {
    const { auth } = setup({ accountType })
    const input = await choose(SMS)
    expect(screen.queryByLabelText(/Trust this device/)).toBeNull()
    fireEvent.change(input, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(auth.verifyOtp).toHaveBeenCalledWith('mfa', { code: '123456', trustDevice: false }))
  })

  it('resend is disabled and counts down from resend_in', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    setup()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: SMS })) })
    const resend = screen.getByRole('button', { name: /Send a new code/ })
    expect(resend).toBeDisabled()
    expect(resend).toHaveTextContent('in 1:00')
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(screen.getByRole('button', { name: /Send a new code/ })).toHaveTextContent('in 0:30')
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled()
  })

  it('send by email instead resends on the other channel', async () => {
    const { auth } = setup()
    await choose(SMS)
    fireEvent.click(screen.getByRole('button', { name: 'Send by email instead' }))
    await waitFor(() => expect(auth.sendOtpCode).toHaveBeenLastCalledWith('mfa', 'email'))
    expect(await screen.findByRole('button', { name: 'Send by text instead' })).toBeInTheDocument()
  })

  it('switching channel is hidden when only one channel exists', async () => {
    const { auth } = setup({ ch: { ...challenge, channels: [channels[0]] } })
    expect(screen.getByRole('button', { name: SMS })).toHaveFocus()
    await choose(SMS)
    expect(auth.sendOtpCode).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /instead/ })).toBeNull()
  })

  it('code_expired offers a new code and keeps the screen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const verifyOtp = vi.fn(async () => { throw fail(400, { detail: 'That code has expired.', code: 'code_expired' }) })
    setup({ auth: { verifyOtp } })
    const input = await choose(SMS)
    fireEvent.change(input, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That code has expired.')
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled()
  })

  it('wrong_code shows the server text and clears the field', async () => {
    const verifyOtp = vi.fn(async () => { throw fail(400, { detail: "That code isn't right. 4 tries left.", code: 'wrong_code' }) })
    setup({ auth: { verifyOtp } })
    const input = await choose(SMS)
    fireEvent.change(input, { target: { value: '111111' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('4 tries left.')
    expect(input).toHaveValue('')
  })

  it('challenge_expired calls onCancel with the message', async () => {
    const verifyOtp = vi.fn(async () => { throw fail(400, { detail: 'Your sign-in timed out. Enter your password again.', code: 'challenge_expired' }) })
    const { onCancel } = setup({ auth: { verifyOtp } })
    const input = await choose(SMS)
    fireEvent.change(input, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(onCancel).toHaveBeenCalledWith('Your sign-in timed out. Enter your password again.'))
  })

  it('try_later disables submit and resend', async () => {
    const verifyOtp = vi.fn(async () => { throw fail(429, { detail: 'Too many wrong codes. Try again tomorrow.', code: 'try_later' }) })
    setup({ auth: { verifyOtp } })
    const input = await choose(SMS)
    fireEvent.change(input, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again tomorrow.')
    fireEvent.change(input, { target: { value: '123456' } })
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Send a new code/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Start again' })).toBeEnabled()
  })

  it('a locked send keeps a visible way out', async () => {
    const sendOtpCode = vi.fn(async () => { throw fail(429, { detail: 'Too many codes asked for. Try again in an hour.', code: 'try_later' }) })
    const { onCancel } = setup({ auth: { sendOtpCode } })
    fireEvent.click(screen.getByRole('button', { name: SMS }))
    expect(await screen.findByRole('alert')).toHaveTextContent('in an hour')
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
    expect(onCancel).toHaveBeenCalledWith()
  })

  it('resend_cooldown restarts the countdown from retry_after', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    const sendOtpCode = vi.fn()
      .mockResolvedValueOnce({ channel: 'sms', hint: SMS, expires_in: 300, resend_in: 1 })
      .mockRejectedValueOnce(fail(429, { detail: 'Please wait before asking for another code.', code: 'resend_cooldown', retry_after: 42 }))
    setup({ auth: { sendOtpCode } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: SMS })) })
    act(() => { vi.advanceTimersByTime(2000) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send a new code' })) })
    expect(screen.getByRole('button', { name: /Send a new code/ })).toHaveTextContent('in 0:42')
    expect(screen.getByRole('button', { name: /Send a new code/ })).toBeDisabled()
  })

  it('channel_unavailable points at the other channel', async () => {
    const sendOtpCode = vi.fn()
      .mockResolvedValueOnce({ channel: 'sms', hint: SMS, expires_in: 300, resend_in: 60 })
      .mockRejectedValueOnce(fail(400, { detail: 'We cannot send to that email right now.', code: 'channel_unavailable' }))
    setup({ auth: { sendOtpCode } })
    await choose(SMS)
    fireEvent.click(screen.getByRole('button', { name: 'Send by email instead' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot send to that email')
    // still on the text channel, with the other way highlighted
    expect(screen.getByRole('button', { name: 'Send by email instead' })).toHaveAttribute('data-suggested', 'true')
  })

  it('a failed first send keeps the choice on screen with the other way available', async () => {
    const sendOtpCode = vi.fn(async () => { throw fail(502, { detail: 'We could not send the text.', code: 'send_failed' }) })
    setup({ auth: { sendOtpCode } })
    fireEvent.click(screen.getByRole('button', { name: SMS }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not send the text')
    expect(screen.getByRole('button', { name: 'Email a code to a•••@x.com' })).toBeEnabled()
  })

  it('an authenticator challenge asks for the app code', async () => {
    const { auth, onSuccess } = setup({ ch: { two_factor_required: true, mfa_token: 'tf' } })
    expect(auth.sendOtpCode).not.toHaveBeenCalled()
    const input = screen.getByLabelText('6-digit code')
    await waitFor(() => expect(input).toHaveFocus())
    fireEvent.change(input, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(signedIn))
    expect(auth.verifyOtp).toHaveBeenCalledWith('tf', { code: '123456', trustDevice: false })
  })

  it('a recovery code is posted as recoveryCode', async () => {
    const { auth } = setup({ ch: { two_factor_required: true, mfa_token: 'tf' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lost your phone? Use a recovery code' }))
    const input = screen.getByLabelText('Recovery code')
    expect(input).not.toHaveAttribute('inputmode', 'numeric')
    fireEvent.change(input, { target: { value: 'abcde-fghjk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(auth.verifyOtp).toHaveBeenCalledWith('tf', { recoveryCode: 'abcde-fghjk', trustDevice: false }))
  })

  it('authenticator_unreadable points at AshantiHub Support', async () => {
    const verifyOtp = vi.fn(async () => { throw fail(400, { detail: 'We could not read your authenticator setup.', code: 'authenticator_unreadable' }) })
    setup({ auth: { verifyOtp }, ch: { two_factor_required: true, mfa_token: 'tf' } })
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ask AshantiHub Support to help you sign in.')
  })

  it('a correct sign-up code that returns two_factor_required moves to the authenticator stage and keeps the trust choice', async () => {
    const verifyOtp = vi.fn()
      .mockResolvedValueOnce({ two_factor_required: true, mfa_token: 'tf2' })
      .mockResolvedValueOnce(signedIn)
    const { onSuccess } = setup({ auth: { verifyOtp }, purpose: 'sign_up' })
    const input = await choose(SMS)
    fireEvent.click(screen.getByLabelText(/Trust this device/))
    fireEvent.change(input, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('button', { name: 'Lost your phone? Use a recovery code' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Trust this device/)).toBeChecked()
    expect(screen.getByLabelText('6-digit code')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '222222' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(signedIn))
    expect(verifyOtp).toHaveBeenLastCalledWith('tf2', { code: '222222', trustDevice: true, registration: 'customer' })
  })

  it('Start again calls onCancel without a message', async () => {
    const { onCancel } = setup()
    await choose(SMS)
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
    expect(onCancel).toHaveBeenCalledWith()
  })

  it('no code or ticket is written to storage', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem')
    setup()
    const input = await choose(SMS)
    fireEvent.change(input, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByLabelText('6-digit code')).toHaveValue(''))
    expect(set).not.toHaveBeenCalled()
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toMatch(/123456|mfa/)
    set.mockRestore()
  })
})
