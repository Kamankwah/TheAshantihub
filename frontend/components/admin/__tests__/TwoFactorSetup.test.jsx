import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecoveryCodes, TwoFactorSetup } from '../TwoFactorSetup.jsx'

vi.mock('../../../lib/saveBlob.js', () => ({ saveBlob: vi.fn() }))
import { saveBlob } from '../../../lib/saveBlob.js'

afterEach(() => vi.clearAllMocks())

describe('RecoveryCodes', () => {
  it('downloads through saveBlob and copies the codes', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<RecoveryCodes codes={['aaaaa-bbbbb', 'ccccc-ddddd']} onDone={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(saveBlob).toHaveBeenCalledTimes(1)
    expect(saveBlob.mock.calls[0][1]).toBe('ashantihub-recovery-codes.txt')
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('aaaaa-bbbbb\nccccc-ddddd'))
    expect(await screen.findByRole('status')).toHaveTextContent('Copied')
  })
})

describe('TwoFactorSetup', () => {
  it('draws the QR code, shows the key, and sends the code with spaces stripped as a string', async () => {
    const onConfirm = vi.fn()
    render(<TwoFactorSetup secret="JBSWY3DPEHPK3PXP" otpauthUri="otpauth://totp/AshantiHub:a?secret=JBSWY3DPEHPK3PXP" onConfirm={onConfirm} />)
    expect(await screen.findByAltText('QR code for your authenticator app')).toBeInTheDocument()
    const input = screen.getByLabelText('6-digit code from the app')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('autocomplete', 'one-time-code')
    fireEvent.change(input, { target: { value: '123 456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Turn on 2-step sign-in' }))
    expect(onConfirm).toHaveBeenCalledWith('123456')
  })

  it('disables the button while busy', () => {
    render(<TwoFactorSetup secret="JBSWY3DPEHPK3PXP" otpauthUri="otpauth://x" onConfirm={() => {}} busy />)
    fireEvent.change(screen.getByLabelText('6-digit code from the app'), { target: { value: '123456' } })
    expect(screen.getByRole('button', { name: 'Turn on 2-step sign-in' })).toBeDisabled()
  })
})
