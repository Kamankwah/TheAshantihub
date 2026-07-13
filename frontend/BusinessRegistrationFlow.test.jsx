import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import BusinessRegistrationFlow from './components/BusinessRegistrationFlow.jsx'

function makeAuth(overrides = {}) {
  return {
    registerBusinessOwner: vi.fn().mockResolvedValue({}),
    submitBusinessInfo: vi.fn().mockResolvedValue({}),
    submitPayoutInfo: vi.fn().mockResolvedValue({}),
    acceptBusinessTerms: vi.fn().mockResolvedValue({}),
    refreshUser: vi.fn().mockResolvedValue({ registration_step: 'payment_info' }),
    logout: vi.fn(),
    ...overrides,
  }
}

function uploadFile(labelText) {
  const file = new File(['(binary)'], 'card.jpg', { type: 'image/jpeg' })
  fireEvent.change(screen.getByLabelText(labelText), { target: { files: [file] } })
}

describe('BusinessRegistrationFlow', () => {
  it('starts at personal_info when there is no user, and advances on submit', async () => {
    const auth = makeAuth()
    render(<BusinessRegistrationFlow user={null} auth={auth} setPage={vi.fn()} setShowBizDash={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Abena Owusu' } })
    fireEvent.change(screen.getByPlaceholderText('Phone (+233...)'), { target: { value: '+233201112233' } })
    fireEvent.change(screen.getByPlaceholderText('Password (min 8 characters)'), { target: { value: 'secretpass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(auth.registerBusinessOwner).toHaveBeenCalledWith(
      expect.objectContaining({ full_name: 'Abena Owusu', login_phone: '+233201112233', password: 'secretpass' })
    ))
    await waitFor(() => expect(screen.getByText(/Tell us about your business/)).toBeInTheDocument())
  })

  it('starts directly at a resumed step when initialStep is provided', () => {
    render(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={makeAuth()} initialStep="payment_info" setPage={vi.fn()} setShowBizDash={vi.fn()} />)
    expect(screen.getByText(/How should we pay you/)).toBeInTheDocument()
  })

  it('business_info step submits KYC fields and advances to the next incomplete step', async () => {
    const auth = makeAuth({ refreshUser: vi.fn().mockResolvedValue({ registration_step: 'payment_info' }) })
    render(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={auth} initialStep="business_info" setPage={vi.fn()} setShowBizDash={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Ghana Card number'), { target: { value: 'GHA-000000000-0' } })
    uploadFile(/Ghana Card — front/i)
    uploadFile(/Ghana Card — back/i)
    fireEvent.change(screen.getByPlaceholderText('GPS address (e.g. AK-123-4567)'), { target: { value: 'AK-123-4567' } })
    fireEvent.change(screen.getByPlaceholderText('Business contact phone (public)'), { target: { value: '+233201112233' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Continue' }).closest('form'))

    await waitFor(() => expect(auth.submitBusinessInfo).toHaveBeenCalledWith(
      expect.objectContaining({ ghana_card_number: 'GHA-000000000-0', gps_address: 'AK-123-4567' })
    ))
    await waitFor(() => expect(screen.getByText(/How should we pay you/)).toBeInTheDocument())
  })

  it('business_info step goes straight to the dashboard when resubmitting fixes the only missing piece', async () => {
    const setShowBizDash = vi.fn()
    const auth = makeAuth({ refreshUser: vi.fn().mockResolvedValue({ registration_step: 'complete' }) })
    render(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={auth} initialStep="business_info" setPage={vi.fn()} setShowBizDash={setShowBizDash} />)

    fireEvent.change(screen.getByPlaceholderText('Ghana Card number'), { target: { value: 'GHA-000000000-0' } })
    uploadFile(/Ghana Card — front/i)
    uploadFile(/Ghana Card — back/i)
    fireEvent.change(screen.getByPlaceholderText('GPS address (e.g. AK-123-4567)'), { target: { value: 'AK-123-4567' } })
    fireEvent.change(screen.getByPlaceholderText('Business contact phone (public)'), { target: { value: '+233201112233' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Continue' }).closest('form'))

    await waitFor(() => expect(setShowBizDash).toHaveBeenCalledWith(true))
  })

  it('reveals certificate and TIN fields only when formally registered is checked', () => {
    render(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={makeAuth()} initialStep="business_info" setPage={vi.fn()} setShowBizDash={vi.fn()} />)
    expect(screen.queryByPlaceholderText('TIN')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/formally registered/i))
    expect(screen.getByPlaceholderText('TIN')).toBeInTheDocument()
  })

  it('payment_info step submits payout fields and advances to terms', async () => {
    const auth = makeAuth({ refreshUser: vi.fn().mockResolvedValue({ registration_step: 'terms' }) })
    render(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={auth} initialStep="payment_info" setPage={vi.fn()} setShowBizDash={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Mobile money number'), { target: { value: '+233201112233' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(auth.submitPayoutInfo).toHaveBeenCalledWith(
      expect.objectContaining({ default_payout_method: 'momo', payout_momo_number: '+233201112233' })
    ))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Business Agreement' })).toBeInTheDocument())
  })

  it('terms step requires the checkbox before Submit for Verification is enabled', () => {
    render(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={makeAuth()} initialStep="terms" setPage={vi.fn()} setShowBizDash={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Submit for Verification' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/I have read and agree/i))
    expect(screen.getByRole('button', { name: 'Submit for Verification' })).not.toBeDisabled()
  })

  it('accepting terms calls acceptBusinessTerms, refreshUser, and opens the dashboard', async () => {
    const auth = makeAuth()
    const setShowBizDash = vi.fn()
    const setPage = vi.fn()
    render(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={auth} initialStep="terms" setPage={setPage} setShowBizDash={setShowBizDash} />)

    fireEvent.click(screen.getByLabelText(/I have read and agree/i))
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Verification' }))

    await waitFor(() => expect(auth.acceptBusinessTerms).toHaveBeenCalled())
    await waitFor(() => expect(auth.refreshUser).toHaveBeenCalled())
    await waitFor(() => expect(setPage).toHaveBeenCalledWith('home'))
    await waitFor(() => expect(setShowBizDash).toHaveBeenCalledWith(true))
  })

  it('shows an error and stays on the same step when a submission fails', async () => {
    const auth = makeAuth({ registerBusinessOwner: vi.fn().mockRejectedValue(new Error('failed')) })
    render(<BusinessRegistrationFlow user={null} auth={auth} setPage={vi.fn()} setShowBizDash={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Abena Owusu' } })
    fireEvent.change(screen.getByPlaceholderText('Phone (+233...)'), { target: { value: '+233201112233' } })
    fireEvent.change(screen.getByPlaceholderText('Password (min 8 characters)'), { target: { value: 'secretpass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(screen.getByText(/Could not create your account/)).toBeInTheDocument())
    expect(screen.getByPlaceholderText('Full name')).toBeInTheDocument()
  })

  it('prefills business_info text fields from the prefill prop', () => {
    render(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={makeAuth()} initialStep="business_info"
      prefill={{ ghana_card_number: 'GHA-111', gps_address: 'AK-1', business_contact_phone: '+233200000000', is_formal: false, tin: '' }}
      setPage={vi.fn()} setShowBizDash={vi.fn()} />)
    expect(screen.getByPlaceholderText('Ghana Card number')).toHaveValue('GHA-111')
    expect(screen.getByPlaceholderText('GPS address (e.g. AK-123-4567)')).toHaveValue('AK-1')
  })

  it('clicking Home navigates back via setPage', () => {
    const setPage = vi.fn()
    render(<BusinessRegistrationFlow user={null} auth={makeAuth()} setPage={setPage} setShowBizDash={vi.fn()} />)
    fireEvent.click(screen.getByText('← Home'))
    expect(setPage).toHaveBeenCalledWith('home')
  })
})
