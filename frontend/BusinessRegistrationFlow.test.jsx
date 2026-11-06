import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from './mocks/server.js'
import { apiPatchForm } from './apiClient.js'
import BusinessRegistrationFlow from './components/BusinessRegistrationFlow.jsx'

// BusinessRegistrationFlow's plan_selection step reads useSubscriptionPlans()
// (GET /api/billing/plans/, public/AllowAny) — the hook is called
// unconditionally at the component's top level (same reason
// App.routing.test.jsx's /business-dashboard tests need this endpoint
// mocked even when not exercising the Subscription tab directly), so every
// render of this component needs both a QueryClientProvider and a default
// handler for it, not just the tests that actually reach plan_selection.
const PLANS = [
  { id: 1, tier: 'product_basic', name: 'Product Basic', kind: 'product', monthly_price: '10.00', features: [], is_recommended: false, max_active_listings: 5, hero_days: 7, boost_credits_per_month: 0 },
  { id: 2, tier: 'product_unlimited', name: 'Product Unlimited', kind: 'product', monthly_price: '30.00', features: [], is_recommended: true, max_active_listings: null, hero_days: 14, boost_credits_per_month: 2 },
  { id: 3, tier: 'service', name: 'Service', kind: 'service', monthly_price: '150.00', features: [], is_recommended: false, max_active_listings: null, hero_days: 14, boost_credits_per_month: 2 },
]

// The public category list (GET /api/listings/categories/), both kinds: the flow shows only the chosen kind's.
const CATEGORIES = [
  { id: 11, slug: 'electronics', icon: '', label: 'Electronics', color: '#000080', kind: 'product' },
  { id: 12, slug: 'fashion', icon: '', label: 'Fashion', color: '#CC0000', kind: 'product' },
  { id: 13, slug: 'groceries', icon: '', label: 'Groceries', color: '#006400', kind: 'product' },
  { id: 21, slug: 'hotels', icon: '', label: 'Hotels', color: '#000080', kind: 'service' },
  { id: 22, slug: 'repairs', icon: '', label: 'Repairs', color: '#CC0000', kind: 'service' },
]

const WEEK = Array.from({ length: 7 }, (_, weekday) => ({ weekday, closed: false, opens: '09:00', closes: '17:00' }))

beforeEach(() => {
  server.use(
    http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json(PLANS)),
    http.get('http://localhost:8000/api/listings/categories/', () => HttpResponse.json(CATEGORIES)),
    // By default the owner has not chosen a kind yet (a self-registered owner); a scout-registered one has.
    http.get('http://localhost:8000/api/accounts/business-owners/me/categories/', () =>
      HttpResponse.json({ business_kind: null, min: 1, max: 10, categories: [] })),
    // By default the owner already has hours; the opening-hours tests below override this.
    http.get('http://localhost:8000/api/accounts/business/hours/', () => HttpResponse.json({ days: WEEK, has_hours: true })),
  )
})

function renderFlow(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  )
}

function makeAuth(overrides = {}) {
  return {
    registerBusinessOwner: vi.fn().mockResolvedValue({}),
    submitBusinessInfo: vi.fn().mockResolvedValue({}),
    submitPlanSelection: vi.fn().mockResolvedValue({}),
    submitPayoutInfo: vi.fn().mockResolvedValue({}),
    acceptBusinessTerms: vi.fn().mockResolvedValue({}),
    refreshUser: vi.fn().mockResolvedValue({ registration_step: 'payment_info' }),
    logout: vi.fn(),
    ...overrides,
  }
}

// The chips are buttons with aria-pressed; pick them by their label.
const chip = (name) => screen.getByRole('button', { name: new RegExp(`^${name}`) })
const pickCategories = (...names) => names.forEach((name) => fireEvent.click(chip(name)))

function uploadFile(labelText) {
  const file = new File(['(binary)'], 'card.jpg', { type: 'image/jpeg' })
  fireEvent.change(screen.getByLabelText(labelText), { target: { files: [file] } })
}

describe('BusinessRegistrationFlow', () => {
  it('starts at personal_info when there is no user, and advances on submit', async () => {
    const auth = makeAuth()
    renderFlow(<BusinessRegistrationFlow user={null} auth={auth} setPage={vi.fn()} setShowBizDash={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Abena Owusu' } })
    fireEvent.change(screen.getByPlaceholderText('Phone (+233...)'), { target: { value: '+233201112233' } })
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'abena@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Password (min 8 characters)'), { target: { value: 'secretpass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(auth.registerBusinessOwner).toHaveBeenCalledWith(
      expect.objectContaining({ full_name: 'Abena Owusu', login_phone: '+233201112233', email: 'abena@example.com', password: 'secretpass' })
    ))
    await waitFor(() => expect(screen.getByText(/Tell us about your business/)).toBeInTheDocument())
  })

  describe('email on the account form', () => {
    const fill = (email) => {
      fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Abena Owusu' } })
      fireEvent.change(screen.getByPlaceholderText('Phone (+233...)'), { target: { value: '+233201112233' } })
      if (email !== undefined) fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: email } })
      fireEvent.change(screen.getByPlaceholderText('Password (min 8 characters)'), { target: { value: 'secretpass' } })
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    }

    it.each([['blank', undefined], ['spaces only', '   '], ['not an email', 'abena'], ['no domain dot', 'abena@example']])(
      'blocks a %s email with the plain message and sends nothing', async (_name, value) => {
        const auth = makeAuth()
        renderFlow(<BusinessRegistrationFlow user={null} auth={auth} setPage={vi.fn()} setShowBizDash={vi.fn()} />)
        fill(value)
        expect(await screen.findByRole('alert')).toHaveTextContent('Enter your email so we can send you a confirmation link.')
        expect(auth.registerBusinessOwner).not.toHaveBeenCalled()
      })

    it('sends the trimmed email', async () => {
      const auth = makeAuth()
      renderFlow(<BusinessRegistrationFlow user={null} auth={auth} setPage={vi.fn()} setShowBizDash={vi.fn()} />)
      fill('  abena@example.com ')
      await waitFor(() => expect(auth.registerBusinessOwner).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'abena@example.com' })
      ))
    })
  })

  it('starts directly at a resumed step when initialStep is provided', () => {
    renderFlow(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={makeAuth()} initialStep="payment_info" setPage={vi.fn()} setShowBizDash={vi.fn()} />)
    expect(screen.getByText(/How should we pay you/)).toBeInTheDocument()
  })

  it('business_info step submits KYC fields and advances to the next incomplete step', async () => {
    const auth = makeAuth({ refreshUser: vi.fn().mockResolvedValue({ registration_step: 'plan_selection' }) })
    renderFlow(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={auth} initialStep="business_info" setPage={vi.fn()} setShowBizDash={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Ghana Card number'), { target: { value: 'GHA-000000000-0' } })
    uploadFile(/Ghana Card — front/i)
    uploadFile(/Ghana Card — back/i)
    fireEvent.change(screen.getByPlaceholderText('Ghana Post GPS address (e.g. AK-039-5028)'), { target: { value: 'AK-123-4567' } })
    fireEvent.change(screen.getByPlaceholderText('Business contact phone (AshantiHub support only, not shown to shoppers)'), { target: { value: '+233201112233' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Continue' }).closest('form'))

    await waitFor(() => expect(auth.submitBusinessInfo).toHaveBeenCalledWith(
      expect.objectContaining({ ghana_card_number: 'GHA-000000000-0', gps_address: 'AK-123-4567' })
    ))
    await waitFor(() => expect(screen.getByText(/Choose your plan/)).toBeInTheDocument())
  })

  it('business_info step goes straight to the dashboard when resubmitting fixes the only missing piece', async () => {
    const setShowBizDash = vi.fn()
    const auth = makeAuth({ refreshUser: vi.fn().mockResolvedValue({ registration_step: 'complete' }) })
    renderFlow(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={auth} initialStep="business_info" setPage={vi.fn()} setShowBizDash={setShowBizDash} />)

    fireEvent.change(screen.getByPlaceholderText('Ghana Card number'), { target: { value: 'GHA-000000000-0' } })
    uploadFile(/Ghana Card — front/i)
    uploadFile(/Ghana Card — back/i)
    fireEvent.change(screen.getByPlaceholderText('Ghana Post GPS address (e.g. AK-039-5028)'), { target: { value: 'AK-123-4567' } })
    fireEvent.change(screen.getByPlaceholderText('Business contact phone (AshantiHub support only, not shown to shoppers)'), { target: { value: '+233201112233' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Continue' }).closest('form'))

    await waitFor(() => expect(setShowBizDash).toHaveBeenCalledWith(true))
  })

  describe('optional identity documents', () => {
    const GPS = 'Ghana Post GPS address (e.g. AK-039-5028)'
    const PHONE = 'Business contact phone (AshantiHub support only, not shown to shoppers)'
    const mountBusinessInfo = (auth) => renderFlow(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={auth} initialStep="business_info" setPage={vi.fn()} setShowBizDash={vi.fn()} />)
    const fillRequired = () => {
      fireEvent.change(screen.getByPlaceholderText(GPS), { target: { value: 'AK-123-4567' } })
      fireEvent.change(screen.getByPlaceholderText(PHONE), { target: { value: '+233201112233' } })
    }
    const submit = () => fireEvent.submit(screen.getByRole('button', { name: 'Continue' }).closest('form'))

    it('submits the business step with no Ghana Card, certificate or TIN', async () => {
      const auth = makeAuth({ refreshUser: vi.fn().mockResolvedValue({ registration_step: 'plan_selection' }) })
      mountBusinessInfo(auth)
      for (const el of [
        screen.getByPlaceholderText('Ghana Card number'),
        screen.getByLabelText(/Ghana Card — front/i),
        screen.getByLabelText(/Ghana Card — back/i),
      ]) expect(el).not.toBeRequired()
      fillRequired()
      submit()

      await waitFor(() => expect(auth.submitBusinessInfo).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(screen.getByText(/Choose your plan/)).toBeInTheDocument())
      expect(screen.queryByText(/Ghana Card number is required/)).not.toBeInTheDocument()
    })

    it('does not require the Ghana Post address, says it is optional, and sends none when left empty', async () => {
      const auth = makeAuth({ refreshUser: vi.fn().mockResolvedValue({ registration_step: 'shop_location' }) })
      mountBusinessInfo(auth)
      expect(screen.getByPlaceholderText(GPS)).not.toBeRequired()
      expect(screen.getByText('Optional. We use your shop pin.')).toBeInTheDocument()
      expect(screen.queryByText(/Ashanti Region only/)).not.toBeInTheDocument()
      fireEvent.change(screen.getByPlaceholderText(PHONE), { target: { value: '+233201112233' } })
      submit()
      await waitFor(() => expect(auth.submitBusinessInfo).toHaveBeenCalledTimes(1))
      expect(auth.submitBusinessInfo.mock.calls[0][0]).toEqual({ business_contact_phone: '+233201112233', is_formal: false })
      expect(screen.getByPlaceholderText(PHONE)).toBeRequired()
    })

    it('still refuses a Ghana Post address that is typed but not valid', async () => {
      const auth = makeAuth()
      mountBusinessInfo(auth)
      fireEvent.change(screen.getByPlaceholderText(PHONE), { target: { value: '+233201112233' } })
      fireEvent.change(screen.getByPlaceholderText(GPS), { target: { value: 'not an address' } })
      submit()
      expect(await screen.findByText(/valid Ghana Post GPS address/)).toBeInTheDocument()
      expect(auth.submitBusinessInfo).not.toHaveBeenCalled()
    })

    it('accepts a Ghana Post code typed loosely and sends the canonical one', async () => {
      const auth = makeAuth({ refreshUser: vi.fn().mockResolvedValue({ registration_step: 'plan_selection' }) })
      mountBusinessInfo(auth)
      fireEvent.change(screen.getByPlaceholderText(PHONE), { target: { value: '+233201112233' } })
      fireEvent.change(screen.getByPlaceholderText(GPS), { target: { value: 'ak0395028' } })
      submit()
      await waitFor(() => expect(auth.submitBusinessInfo).toHaveBeenCalledWith(
        expect.objectContaining({ gps_address: 'AK-039-5028' })
      ))
    })

    it('shows the format message for a code that is too short, and sends nothing', async () => {
      const auth = makeAuth()
      mountBusinessInfo(auth)
      fireEvent.change(screen.getByPlaceholderText(PHONE), { target: { value: '+233201112233' } })
      fireEvent.change(screen.getByPlaceholderText(GPS), { target: { value: 'AK03950' } })
      submit()
      expect(await screen.findByText('Enter a valid Ghana Post GPS address, e.g. AK-039-5028.')).toBeInTheDocument()
      expect(auth.submitBusinessInfo).not.toHaveBeenCalled()
    })

    it('keeps the business wording for a non-Ashanti code', async () => {
      const auth = makeAuth()
      mountBusinessInfo(auth)
      fireEvent.change(screen.getByPlaceholderText(PHONE), { target: { value: '+233201112233' } })
      fireEvent.change(screen.getByPlaceholderText(GPS), { target: { value: 'GA-039-5028' } })
      submit()
      expect(await screen.findByText(/AshantiHub only admits businesses in the Ashanti Region/)).toBeInTheDocument()
      expect(auth.submitBusinessInfo).not.toHaveBeenCalled()
    })

    it('tidies the field to the canonical code when it is left', () => {
      mountBusinessInfo(makeAuth())
      const gps = screen.getByPlaceholderText(GPS)
      fireEvent.change(gps, { target: { value: 'ao t010 3560' } })
      fireEvent.blur(gps)
      expect(gps).toHaveValue('AO-T010-3560')
      fireEvent.change(gps, { target: { value: 'AK03950' } })
      fireEvent.blur(gps)
      expect(gps).toHaveValue('AK03950')
    })

    it('shows the registered tick and optional certificate/TIN inputs only when ticked', () => {
      mountBusinessInfo(makeAuth())
      const tick = screen.getByLabelText(/This business is registered/i)
      expect(tick).toHaveAttribute('type', 'checkbox')
      expect(tick).not.toBeChecked()
      expect(screen.queryByPlaceholderText('TIN')).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/Business registration certificate/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/add these later from your dashboard/i)).not.toBeInTheDocument()

      fireEvent.click(tick)
      expect(screen.getByPlaceholderText('TIN')).not.toBeRequired()
      expect(screen.getByLabelText(/Business registration certificate/i)).not.toBeRequired()
      expect(screen.getByText(/add these later from your dashboard/i)).toBeInTheDocument()

      fireEvent.click(tick)
      expect(screen.queryByPlaceholderText('TIN')).not.toBeInTheDocument()
    })

    it('explains that the Ghana Card is optional and earns the verified check mark', () => {
      mountBusinessInfo(makeAuth())
      expect(screen.getByText(/Add your Ghana Card to earn the verified check mark/)).toBeInTheDocument()
    })

    it('does not send empty file fields', async () => {
      const auth = makeAuth({ refreshUser: vi.fn().mockResolvedValue({ registration_step: 'plan_selection' }) })
      mountBusinessInfo(auth)
      fireEvent.change(screen.getByPlaceholderText('Ghana Card number'), { target: { value: '   ' } })
      fillRequired()
      fireEvent.click(screen.getByLabelText(/This business is registered/i))
      submit()

      await waitFor(() => expect(auth.submitBusinessInfo).toHaveBeenCalledTimes(1))
      const sent = auth.submitBusinessInfo.mock.calls[0][0]
      expect(sent).toEqual({
        gps_address: 'AK-123-4567',
        business_contact_phone: '+233201112233',
        is_formal: true,
      })
    })

    it('sends the Ghana Card, certificate and TIN when the owner filled them', async () => {
      const auth = makeAuth({ refreshUser: vi.fn().mockResolvedValue({ registration_step: 'plan_selection' }) })
      mountBusinessInfo(auth)
      fireEvent.change(screen.getByPlaceholderText('Ghana Card number'), { target: { value: ' GHA-000000000-0 ' } })
      uploadFile(/Ghana Card — front/i)
      uploadFile(/Ghana Card — back/i)
      fillRequired()
      fireEvent.click(screen.getByLabelText(/This business is registered/i))
      uploadFile(/Business registration certificate/i)
      fireEvent.change(screen.getByPlaceholderText('TIN'), { target: { value: 'C0012345678' } })
      submit()

      await waitFor(() => expect(auth.submitBusinessInfo).toHaveBeenCalledTimes(1))
      const sent = auth.submitBusinessInfo.mock.calls[0][0]
      expect(sent.ghana_card_number).toBe('GHA-000000000-0')
      expect(sent.ghana_card_front_image).toBeInstanceOf(File)
      expect(sent.ghana_card_back_image).toBeInstanceOf(File)
      expect(sent.business_reg_certificate).toBeInstanceOf(File)
      expect(sent.tin).toBe('C0012345678')
      expect(sent.is_formal).toBe(true)
    })
  })

  describe('shop_location step', () => {
    it('goes business_info -> shop_location -> plan_selection, never through payment_info', async () => {
      const refreshUser = vi.fn()
        .mockResolvedValueOnce({ registration_step: 'shop_location' })
        .mockResolvedValueOnce({ registration_step: 'plan_selection' })
      const auth = makeAuth({ refreshUser })
      server.use(http.post('http://localhost:8000/api/accounts/me/location/', () => HttpResponse.json({ plus_code: '6CRWM9QG+C6', landmark: '', tier: 'located', tier_label: 'Location shared by the owner', is_manual: true })))
      renderFlow(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={auth} initialStep="business_info" setPage={vi.fn()} setShowBizDash={vi.fn()} />)

      fireEvent.change(screen.getByPlaceholderText('Business contact phone (AshantiHub support only, not shown to shoppers)'), { target: { value: '+233201112233' } })
      fireEvent.submit(screen.getByRole('button', { name: 'Continue' }).closest('form'))

      expect(await screen.findByRole('heading', { name: 'Where is your shop?' })).toBeInTheDocument()
      expect(screen.getByText(/STEP 3 of 5: Your shop location/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'drop-pin' }))
      fireEvent.click(screen.getByRole('button', { name: 'Save my shop location' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))

      expect(await screen.findByText(/Choose your plan/)).toBeInTheDocument()
      expect(screen.queryByText(/How should we pay you/)).not.toBeInTheDocument()
    })

    it('reaches the shop location step through the real profile PATCH with no Ghana Post address', async () => {
      let sentGps = 'unset'
      server.use(http.patch('http://localhost:8000/api/accounts/business-owners/me/profile/', async ({ request }) => {
        sentGps = (await request.formData()).get('gps_address')
        return HttpResponse.json({ registration_step: 'shop_location' })
      }))
      const auth = makeAuth({
        submitBusinessInfo: (fields) => {
          const formData = new FormData()
          Object.entries(fields).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') formData.append(k, v) })
          return apiPatchForm('/api/accounts/business-owners/me/profile/', formData)
        },
        refreshUser: vi.fn().mockResolvedValue({ registration_step: 'shop_location' }),
      })
      renderFlow(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={auth} initialStep="business_info" setPage={vi.fn()} setShowBizDash={vi.fn()} />)
      fireEvent.change(screen.getByPlaceholderText('Business contact phone (AshantiHub support only, not shown to shoppers)'), { target: { value: '+233201112233' } })
      fireEvent.submit(screen.getByRole('button', { name: 'Continue' }).closest('form'))
      expect(await screen.findByRole('heading', { name: 'Where is your shop?' })).toBeInTheDocument()
      expect(sentGps).toBeNull()
    })

    it('resumes at shop_location when the server says that is the next step', () => {
      renderFlow(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={makeAuth()} initialStep="shop_location" setPage={vi.fn()} setShowBizDash={vi.fn()} />)
      expect(screen.getByRole('heading', { name: 'Where is your shop?' })).toBeInTheDocument()
    })
  })

  describe('plan_selection step', () => {
    it('shows the business-kind choice first, then plan cards once a kind is chosen', async () => {
      renderFlow(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={makeAuth()} initialStep="plan_selection" setPage={vi.fn()} setShowBizDash={vi.fn()} />)

      expect(screen.getByText(/I sell products/)).toBeInTheDocument()
      expect(screen.getByText(/I offer services/)).toBeInTheDocument()
      expect(screen.queryByText('Product Basic')).not.toBeInTheDocument()

      fireEvent.click(screen.getByText(/I sell products/))

      await waitFor(() => expect(screen.getByText('Product Basic')).toBeInTheDocument())
      expect(screen.getByText('Product Unlimited')).toBeInTheDocument()
      expect(screen.queryByText('Service')).not.toBeInTheDocument()
    })

    it('filters plans by the selected business kind', async () => {
      renderFlow(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={makeAuth()} initialStep="plan_selection" setPage={vi.fn()} setShowBizDash={vi.fn()} />)

      fireEvent.click(screen.getByText(/I offer services/))

      await waitFor(() => expect(screen.getByText('Service')).toBeInTheDocument())
      expect(screen.queryByText('Product Basic')).not.toBeInTheDocument()
      expect(screen.queryByText('Product Unlimited')).not.toBeInTheDocument()
    })

    it('shows free-trial messaging and never renders a payment amount or payment UI', async () => {
      renderFlow(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={makeAuth()} initialStep="plan_selection" setPage={vi.fn()} setShowBizDash={vi.fn()} />)

      fireEvent.click(screen.getByText(/I sell products/))

      await waitFor(() => expect(screen.getByText(/FREE/)).toBeInTheDocument())
      expect(screen.queryByText(/Simulate Pay/i)).not.toBeInTheDocument()
    })

    it('disables the submit button until a kind, a plan and a category are all chosen', async () => {
      renderFlow(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={makeAuth()} initialStep="plan_selection" setPage={vi.fn()} setShowBizDash={vi.fn()} />)

      expect(screen.getByRole('button', { name: 'Start Free Trial' })).toBeDisabled()

      fireEvent.click(screen.getByText(/I sell products/))
      expect(screen.getByRole('button', { name: 'Start Free Trial' })).toBeDisabled()

      await waitFor(() => expect(screen.getByText('Product Basic')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Product Basic'))
      expect(screen.getByRole('button', { name: 'Start Free Trial' })).toBeDisabled()

      pickCategories('Electronics')
      expect(screen.getByRole('button', { name: 'Start Free Trial' })).not.toBeDisabled()
    })

    it('submits the chosen business_kind/plan/cycle_months and advances to whatever step the server reports', async () => {
      const auth = makeAuth({ refreshUser: vi.fn().mockResolvedValue({ registration_step: 'payment_info' }) })
      renderFlow(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={auth} initialStep="plan_selection" setPage={vi.fn()} setShowBizDash={vi.fn()} />)

      fireEvent.click(screen.getByText(/I sell products/))
      await waitFor(() => expect(screen.getByText('Product Basic')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Product Basic'))
      pickCategories('Fashion', 'Electronics')

      await waitFor(() => expect(screen.getByText('6 mo')).toBeInTheDocument())
      fireEvent.click(screen.getByText('6 mo'))

      fireEvent.click(screen.getByRole('button', { name: 'Start Free Trial' }))

      await waitFor(() => expect(auth.submitPlanSelection).toHaveBeenCalledWith({
        business_kind: 'product', plan: 'product_basic', cycle_months: 6, categories: [12, 11],
      }))
      await waitFor(() => expect(screen.getByText(/How should we pay you/)).toBeInTheDocument())
    })

    it('shows an error and stays on plan_selection when the submission fails', async () => {
      const auth = makeAuth({ submitPlanSelection: vi.fn().mockRejectedValue(new Error('failed')) })
      renderFlow(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={auth} initialStep="plan_selection" setPage={vi.fn()} setShowBizDash={vi.fn()} />)

      fireEvent.click(screen.getByText(/I sell products/))
      await waitFor(() => expect(screen.getByText('Product Basic')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Product Basic'))
      pickCategories('Electronics')
      fireEvent.click(screen.getByRole('button', { name: 'Start Free Trial' }))

      await waitFor(() => expect(screen.getByText(/Could not save your plan selection/)).toBeInTheDocument())
    })
  })

  it('payment_info step submits payout fields and advances to terms', async () => {
    const auth = makeAuth({ refreshUser: vi.fn().mockResolvedValue({ registration_step: 'terms' }) })
    renderFlow(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={auth} initialStep="payment_info" setPage={vi.fn()} setShowBizDash={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Mobile money number'), { target: { value: '+233201112233' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(auth.submitPayoutInfo).toHaveBeenCalledWith(
      expect.objectContaining({ default_payout_method: 'momo', payout_momo_number: '+233201112233' })
    ))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Business Agreement' })).toBeInTheDocument())
  })

  it('terms step requires the checkbox before Submit for Verification is enabled', async () => {
    renderFlow(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={makeAuth()} initialStep="terms" setPage={vi.fn()} setShowBizDash={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Submit for Verification' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/I have read and agree/i))
    expect(screen.getByRole('button', { name: 'Submit for Verification' })).not.toBeDisabled()
  })

  it('accepting terms calls acceptBusinessTerms, refreshUser, and opens the dashboard', async () => {
    const auth = makeAuth()
    const setShowBizDash = vi.fn()
    const setPage = vi.fn()
    renderFlow(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={auth} initialStep="terms" setPage={setPage} setShowBizDash={setShowBizDash} />)

    fireEvent.click(await screen.findByLabelText(/I have read and agree/i))
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Verification' }))

    await waitFor(() => expect(auth.acceptBusinessTerms).toHaveBeenCalled())
    await waitFor(() => expect(auth.refreshUser).toHaveBeenCalled())
    await waitFor(() => expect(setPage).toHaveBeenCalledWith('home'))
    await waitFor(() => expect(setShowBizDash).toHaveBeenCalledWith(true))
  })

  it('shows an error and stays on the same step when a submission fails', async () => {
    const auth = makeAuth({ registerBusinessOwner: vi.fn().mockRejectedValue(new Error('failed')) })
    renderFlow(<BusinessRegistrationFlow user={null} auth={auth} setPage={vi.fn()} setShowBizDash={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Abena Owusu' } })
    fireEvent.change(screen.getByPlaceholderText('Phone (+233...)'), { target: { value: '+233201112233' } })
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'abena@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Password (min 8 characters)'), { target: { value: 'secretpass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(screen.getByText(/Could not create your account/)).toBeInTheDocument())
    expect(screen.getByPlaceholderText('Full name')).toBeInTheDocument()
  })

  it('prefills business_info text fields from the prefill prop', () => {
    renderFlow(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={makeAuth()} initialStep="business_info"
      prefill={{ ghana_card_number: 'GHA-111', gps_address: 'AK-1', business_contact_phone: '+233200000000', is_formal: false, tin: '' }}
      setPage={vi.fn()} setShowBizDash={vi.fn()} />)
    expect(screen.getByPlaceholderText('Ghana Card number')).toHaveValue('GHA-111')
    expect(screen.getByPlaceholderText('Ghana Post GPS address (e.g. AK-039-5028)')).toHaveValue('AK-1')
  })

  it('clicking Home navigates back via setPage', () => {
    const setPage = vi.fn()
    renderFlow(<BusinessRegistrationFlow user={null} auth={makeAuth()} setPage={setPage} setShowBizDash={vi.fn()} />)
    fireEvent.click(screen.getByText('← Home'))
    expect(setPage).toHaveBeenCalledWith('home')
  })

  describe('opening hours (terms step)', () => {
    const fill = (day, opens, closes) => {
      fireEvent.change(screen.getByLabelText(`${day} opens`), { target: { value: opens } })
      fireEvent.change(screen.getByLabelText(`${day} closes`), { target: { value: closes } })
    }

    it('registration blocks Next until hours entered, then saves them and shows the agreement', async () => {
      let saved = null
      server.use(
        http.get('http://localhost:8000/api/accounts/business/hours/', () => (
          saved ? HttpResponse.json({ days: saved, has_hours: true }) : HttpResponse.json({ days: [], has_hours: false })
        )),
        http.put('http://localhost:8000/api/accounts/business/hours/', async ({ request }) => {
          saved = (await request.json()).days
          return HttpResponse.json({ days: saved, has_hours: true })
        }),
      )
      renderFlow(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={makeAuth()} initialStep="terms" setPage={vi.fn()} setShowBizDash={vi.fn()} />)

      const next = await screen.findByRole('button', { name: 'Next' })
      expect(next).toBeDisabled()
      expect(screen.queryByRole('heading', { name: 'Business Agreement' })).not.toBeInTheDocument()

      fill('Monday', '09:00', '17:00')
      fireEvent.click(screen.getByRole('button', { name: 'Copy Monday to weekdays' }))
      expect(screen.getByLabelText('Friday closes')).toHaveValue('17:00')
      expect(next).toBeDisabled() // Saturday and Sunday are still blank
      fireEvent.click(screen.getByLabelText('Saturday closed'))
      fireEvent.click(screen.getByLabelText('Sunday closed'))
      expect(next).not.toBeDisabled()

      fireEvent.click(next)
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Business Agreement' })).toBeInTheDocument())
      expect(saved).toHaveLength(7)
      expect(saved[0]).toEqual({ weekday: 0, closed: false, opens: '09:00', closes: '17:00' })
      expect(saved[5]).toEqual({ weekday: 5, closed: true, opens: null, closes: null })
    })

    it('refuses an opening time that is not before closing time', async () => {
      server.use(http.get('http://localhost:8000/api/accounts/business/hours/', () => HttpResponse.json({ days: [], has_hours: false })))
      renderFlow(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={makeAuth()} initialStep="terms" setPage={vi.fn()} setShowBizDash={vi.fn()} />)
      await screen.findByRole('button', { name: 'Next' })
      fill('Monday', '18:00', '09:00')
      expect(screen.getByRole('alert')).toHaveTextContent(/Monday: opening time must be before closing time/)
    })
  })

  it('business registration waits for the code before the business_info step', async () => {
    const challenge = { id: 7, full_name: 'Abena Owusu', otp_required: true, mfa_token: 'mfa-9', channels: [{ channel: 'sms', hint: '024 *** 2233' }] }
    const auth = makeAuth({
      registerBusinessOwner: vi.fn().mockResolvedValue(challenge),
      sendOtpCode: vi.fn().mockResolvedValue({ channel: 'sms', hint: '024 *** 2233', resend_in: 60 }),
      verifyOtp: vi.fn().mockResolvedValue({ token: 't', account_type: 'business_owner', registration_step: 'business_info' }),
    })
    renderFlow(<BusinessRegistrationFlow user={null} auth={auth} setPage={vi.fn()} setShowBizDash={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Abena Owusu' } })
    fireEvent.change(screen.getByPlaceholderText('Phone (+233...)'), { target: { value: '+233201112233' } })
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'abena@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Password (min 8 characters)'), { target: { value: 'secretpass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    fireEvent.click(await screen.findByText('Text a code to 024 *** 2233'))
    expect(screen.queryByText(/Tell us about your business/)).not.toBeInTheDocument()
    fireEvent.change(await screen.findByLabelText('6-digit code'), { target: { value: '123456' } })
    expect(screen.queryByText(/Tell us about your business/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(auth.verifyOtp).toHaveBeenCalledWith('mfa-9', expect.objectContaining({ code: '123456', registration: 'business_owner' })))
    expect(await screen.findByText(/Tell us about your business/)).toBeInTheDocument()
  })

  it('Start again on the registration code screen returns to the personal details', async () => {
    const challenge = { id: 7, otp_required: true, mfa_token: 'mfa-9', channels: [{ channel: 'sms', hint: '024 *** 2233' }] }
    const auth = makeAuth({ registerBusinessOwner: vi.fn().mockResolvedValue(challenge) })
    renderFlow(<BusinessRegistrationFlow user={null} auth={auth} setPage={vi.fn()} setShowBizDash={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Abena Owusu' } })
    fireEvent.change(screen.getByPlaceholderText('Phone (+233...)'), { target: { value: '+233201112233' } })
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'abena@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Password (min 8 characters)'), { target: { value: 'secretpass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Start again' }))
    expect(screen.getByPlaceholderText('Full name')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Password (min 8 characters)')).toHaveValue('')
  })

  describe('with no plans offered', () => {
    const noPlans = () => server.use(http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json([])))
    const renderTypeStep = (auth = makeAuth()) => renderFlow(
      <BusinessRegistrationFlow user={{fullName:'Abena'}} auth={auth} initialStep="plan_selection" setPage={vi.fn()} setShowBizDash={vi.fn()} />,
    )

    it('with no plans offered it asks only for the business type', async () => {
      noPlans()
      renderTypeStep()
      expect(await screen.findByText('What kind of business is this?')).toBeInTheDocument()
      expect(screen.getByText(/I sell products/)).toBeInTheDocument()
      expect(screen.getByText(/I offer services/)).toBeInTheDocument()
      expect(screen.getByText('This is set once and decides which tools your dashboard shows.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
      fireEvent.click(screen.getByText(/I offer services/))
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
      pickCategories('Hotels')
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    })

    it('the step label reads Your Business Type', async () => {
      noPlans()
      renderTypeStep()
      expect(await screen.findByText(/4 of 5: Your Business Type/)).toBeInTheDocument()
      expect(screen.queryByText(/Choose Your Plan/)).not.toBeInTheDocument()
    })

    it('continue posts business_kind and goes to the step the server names', async () => {
      noPlans()
      let posted = null
      server.use(http.post('http://localhost:8000/api/billing/business-kind/', async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json({ business_kind: 'product', registration_step: 'payment_info' })
      }))
      const auth = makeAuth()
      renderTypeStep(auth)
      fireEvent.click(await screen.findByText(/I sell products/))
      pickCategories('Electronics')
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      expect(await screen.findByText(/How should we pay you/)).toBeInTheDocument()
      expect(posted).toEqual({ business_kind: 'product', categories: [11] })
      expect(auth.refreshUser).toHaveBeenCalled()
      expect(auth.submitPlanSelection).not.toHaveBeenCalled()
    })

    it('no price, plan, trial or cycle text appears with no plans offered', async () => {
      noPlans()
      renderTypeStep()
      fireEvent.click(await screen.findByText(/I sell products/))
      const text = document.body.textContent
      expect(text).not.toMatch(/GHS|free|trial|billing cycle|\/ month|plan/i)
    })

    it('a use_plan_selection answer shows the server text and reloads the plans', async () => {
      noPlans()
      let planLoads = 0
      server.use(
        http.get('http://localhost:8000/api/billing/plans/', () => { planLoads += 1; return HttpResponse.json(planLoads === 1 ? [] : PLANS) }),
        http.post('http://localhost:8000/api/billing/business-kind/', () =>
          HttpResponse.json({ detail: 'Choose a plan to continue.', code: 'use_plan_selection' }, { status: 409 })),
      )
      renderTypeStep()
      fireEvent.click(await screen.findByText(/I sell products/))
      pickCategories('Electronics')
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      expect(await screen.findByText('Choose a plan to continue.')).toBeInTheDocument()
      await waitFor(() => expect(planLoads).toBe(2))
      expect(await screen.findByText(/Choose Your Plan/)).toBeInTheDocument()
    })

    it('a 400 shows the server message', async () => {
      noPlans()
      server.use(http.post('http://localhost:8000/api/billing/business-kind/', () =>
        HttpResponse.json({ business_kind: 'Your business type is already set.' }, { status: 400 })))
      renderTypeStep()
      fireEvent.click(await screen.findByText(/I sell products/))
      pickCategories('Electronics')
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      expect(await screen.findByText('Your business type is already set.')).toBeInTheDocument()
    })

    it('while plans are loading the plan screen is shown, not the type step', async () => {
      server.use(http.get('http://localhost:8000/api/billing/plans/', () => new Promise(() => {})))
      renderTypeStep()
      expect(screen.getByText(/4 of 5: Choose Your Plan/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Start Free Trial' })).toBeInTheDocument()
      expect(screen.queryByText('What kind of business is this?')).not.toBeInTheDocument()
    })
  })

  describe('categories chosen with the kind', () => {
    const noPlans = () => server.use(http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json([])))
    const mount = (auth = makeAuth()) => renderFlow(
      <BusinessRegistrationFlow user={{fullName:'Abena'}} auth={auth} initialStep="plan_selection" setPage={vi.fn()} setShowBizDash={vi.fn()} />,
    )
    const pressed = (name) => chip(name).getAttribute('aria-pressed') === 'true'

    it('choosing a kind shows category chips for that kind only', async () => {
      mount()
      expect(screen.queryByText('What do you sell or do?')).not.toBeInTheDocument()
      fireEvent.click(screen.getByText(/I sell products/))
      expect(await screen.findByText('What do you sell or do?')).toBeInTheDocument()
      expect(screen.getByText('Choose all that apply. You can change this later from your profile.')).toBeInTheDocument()
      expect(await screen.findByRole('button', { name: /^Electronics/ })).toBeInTheDocument()
      expect(chip('Fashion')).toBeInTheDocument()
      expect(chip('Groceries')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Hotels/ })).not.toBeInTheDocument()
      fireEvent.click(screen.getByText(/I offer services/))
      expect(await screen.findByRole('button', { name: /^Hotels/ })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Electronics/ })).not.toBeInTheDocument()
    })

    it('shows the chips in the kind-only form too', async () => {
      noPlans()
      mount()
      fireEvent.click(await screen.findByText(/I offer services/))
      expect(await screen.findByText('What do you sell or do?')).toBeInTheDocument()
      expect(await screen.findByRole('button', { name: /^Repairs/ })).toBeInTheDocument()
    })

    it('changing the kind clears the picks', async () => {
      mount()
      fireEvent.click(screen.getByText(/I sell products/))
      await screen.findByRole('button', { name: /^Electronics/ })
      pickCategories('Electronics', 'Fashion')
      expect(pressed('Electronics')).toBe(true)
      fireEvent.click(screen.getByText(/I offer services/))
      await screen.findByRole('button', { name: /^Hotels/ })
      expect(pressed('Hotels')).toBe(false)
      fireEvent.click(screen.getByText(/I sell products/))
      await screen.findByRole('button', { name: /^Electronics/ })
      expect(pressed('Electronics')).toBe(false)
      expect(pressed('Fashion')).toBe(false)
    })

    it('continue is disabled until at least one category is chosen', async () => {
      noPlans()
      mount()
      fireEvent.click(await screen.findByText(/I sell products/))
      await screen.findByRole('button', { name: /^Electronics/ })
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
      pickCategories('Groceries')
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
      pickCategories('Groceries')
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    })

    it('start-trial posts business_kind plan cycle_months and categories in order', async () => {
      const auth = makeAuth()
      mount(auth)
      fireEvent.click(screen.getByText(/I offer services/))
      fireEvent.click(await screen.findByText('Service'))
      pickCategories('Repairs', 'Hotels')
      fireEvent.click(await screen.findByText('3 mo'))
      fireEvent.click(screen.getByRole('button', { name: 'Start Free Trial' }))
      await waitFor(() => expect(auth.submitPlanSelection).toHaveBeenCalledTimes(1))
      expect(auth.submitPlanSelection.mock.calls[0][0]).toEqual({
        business_kind: 'service', plan: 'service', cycle_months: 3, categories: [22, 21],
      })
    })

    it('business-kind posts business_kind and categories', async () => {
      noPlans()
      let posted = null
      server.use(http.post('http://localhost:8000/api/billing/business-kind/', async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json({ business_kind: 'service', registration_step: 'payment_info' })
      }))
      mount()
      fireEvent.click(await screen.findByText(/I offer services/))
      await screen.findByRole('button', { name: /^Hotels/ })
      pickCategories('Hotels', 'Repairs')
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      expect(await screen.findByText(/How should we pay you/)).toBeInTheDocument()
      expect(posted).toEqual({ business_kind: 'service', categories: [21, 22] })
    })

    it('a 400 from the server shows its message and keeps the picks', async () => {
      noPlans()
      server.use(http.post('http://localhost:8000/api/billing/business-kind/', () =>
        HttpResponse.json({ categories: ['Choose at least one category.'] }, { status: 400 })))
      mount()
      fireEvent.click(await screen.findByText(/I sell products/))
      await screen.findByRole('button', { name: /^Electronics/ })
      pickCategories('Fashion', 'Groceries')
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      expect(await screen.findByText('Choose at least one category.')).toBeInTheDocument()
      expect(pressed('Fashion')).toBe(true)
      expect(pressed('Groceries')).toBe(true)
      expect(pressed('Electronics')).toBe(false)
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    })

    it('a 400 from start-trial shows its message and keeps the picks', async () => {
      const err = Object.assign(new Error('400'), { status: 400, body: { categories: ['One of these categories is not a product category.'] } })
      const auth = makeAuth({ submitPlanSelection: vi.fn().mockRejectedValue(err) })
      mount(auth)
      fireEvent.click(screen.getByText(/I sell products/))
      fireEvent.click(await screen.findByText('Product Basic'))
      pickCategories('Electronics')
      fireEvent.click(screen.getByRole('button', { name: 'Start Free Trial' }))
      expect(await screen.findByText('One of these categories is not a product category.')).toBeInTheDocument()
      expect(pressed('Electronics')).toBe(true)
    })

    it('says so when the category list is empty or failed to load', async () => {
      noPlans()
      server.use(http.get('http://localhost:8000/api/listings/categories/', () => HttpResponse.json([])))
      mount()
      fireEvent.click(await screen.findByText(/I sell products/))
      expect(await screen.findByText('No categories of this kind yet — ask Operations to add one.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    })

    it('says so when the categories could not be loaded', async () => {
      noPlans()
      server.use(http.get('http://localhost:8000/api/listings/categories/', () => HttpResponse.json({ detail: 'down' }, { status: 500 })))
      mount()
      fireEvent.click(await screen.findByText(/I sell products/))
      expect(await screen.findByText(/Couldn.t load the categories/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    })

    it('never asks for the zones: only the categories are needed here', async () => {
      noPlans()
      let zonesAsked = 0
      server.use(http.get('http://localhost:8000/api/listings/zones/', () => { zonesAsked += 1; return HttpResponse.json([]) }))
      mount()
      fireEvent.click(await screen.findByText(/I sell products/))
      expect(await screen.findByRole('button', { name: /^Electronics/ })).toBeInTheDocument()
      expect(zonesAsked).toBe(0)
    })

    it('a failed category load offers Try again, which loads them', async () => {
      noPlans()
      let calls = 0
      server.use(http.get('http://localhost:8000/api/listings/categories/', () => {
        calls += 1
        return calls === 1 ? HttpResponse.json({ detail: 'down' }, { status: 500 }) : HttpResponse.json(CATEGORIES)
      }))
      mount()
      fireEvent.click(await screen.findByText(/I sell products/))
      expect(await screen.findByText(/Couldn.t load the categories/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByRole('button', { name: /^Electronics/ })).toBeInTheDocument()
      expect(screen.queryByText(/Couldn.t load the categories/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Continue without categories/ })).not.toBeInTheDocument()
      expect(calls).toBe(2)
    })

    it('while the categories are loading, Continue stays disabled and there is no way round them', async () => {
      noPlans()
      server.use(http.get('http://localhost:8000/api/listings/categories/', () => new Promise(() => {})))
      mount()
      fireEvent.click(await screen.findByText(/I sell products/))
      expect(await screen.findByText('Loading categories…')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
      expect(screen.queryByRole('button', { name: /Continue without categories/ })).not.toBeInTheDocument()
    })

    it('when the categories cannot load, a separate action continues without them (business-kind)', async () => {
      noPlans()
      let posted = null
      server.use(
        http.get('http://localhost:8000/api/listings/categories/', () => HttpResponse.json({ detail: 'down' }, { status: 500 })),
        http.post('http://localhost:8000/api/billing/business-kind/', async ({ request }) => {
          posted = await request.json()
          return HttpResponse.json({ business_kind: 'product', registration_step: 'payment_info' })
        }),
      )
      mount()
      fireEvent.click(await screen.findByText(/I sell products/))
      const skip = await screen.findByRole('button', { name: 'Continue without categories (add them later in Profile)' })
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
      fireEvent.click(skip)
      expect(await screen.findByText(/How should we pay you/)).toBeInTheDocument()
      expect(posted).toEqual({ business_kind: 'product' })
    })

    it('when the categories cannot load, the trial can start without them once a plan is chosen', async () => {
      server.use(http.get('http://localhost:8000/api/listings/categories/', () => HttpResponse.json({ detail: 'down' }, { status: 500 })))
      const auth = makeAuth()
      mount(auth)
      fireEvent.click(screen.getByText(/I sell products/))
      const skip = await screen.findByRole('button', { name: 'Continue without categories (add them later in Profile)' })
      expect(skip).toBeDisabled()
      fireEvent.click(await screen.findByText('Product Basic'))
      expect(skip).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Start Free Trial' })).toBeDisabled()
      fireEvent.click(skip)
      await waitFor(() => expect(auth.submitPlanSelection).toHaveBeenCalledTimes(1))
      expect(auth.submitPlanSelection.mock.calls[0][0]).toEqual({ business_kind: 'product', plan: 'product_basic', cycle_months: 1 })
    })

    it('a scout-registered owner whose kind is already set is not asked for categories', async () => {
      server.use(http.get('http://localhost:8000/api/accounts/business-owners/me/categories/', () =>
        HttpResponse.json({ business_kind: 'product', min: 1, max: 10, categories: [] })))
      const auth = makeAuth()
      mount(auth)
      fireEvent.click(screen.getByText(/I sell products/))
      fireEvent.click(await screen.findByText('Product Basic'))
      await waitFor(() => expect(screen.queryByText('What do you sell or do?')).not.toBeInTheDocument())
      expect(screen.queryByRole('button', { name: /^Electronics/ })).not.toBeInTheDocument()
      const start = screen.getByRole('button', { name: 'Start Free Trial' })
      await waitFor(() => expect(start).toBeEnabled())
      fireEvent.click(start)
      await waitFor(() => expect(auth.submitPlanSelection).toHaveBeenCalledTimes(1))
      expect(auth.submitPlanSelection.mock.calls[0][0]).not.toHaveProperty('categories')
    })
  })

  describe('personal info from Your Account (Sell on AshantiHub)', () => {
    const prefill = { full_name: 'Ama Boateng', phone: '0244000111', email: 'ama@example.com' }

    it('seeds the personal info fields from prefill.full_name, phone and email', () => {
      renderFlow(<BusinessRegistrationFlow user={null} auth={makeAuth()} prefill={prefill} setPage={vi.fn()} setShowBizDash={vi.fn()} />)
      expect(screen.getByPlaceholderText('Full name')).toHaveValue('Ama Boateng')
      expect(screen.getByPlaceholderText(/Phone/)).toHaveValue('0244000111')
      expect(screen.getByPlaceholderText('Email')).toHaveValue('ama@example.com')
    })

    it('shows the server refusal for a contact already used by a business account', async () => {
      const err = Object.assign(new Error('400'), { status: 400, body: { login_phone: ['A business account with this phone number already exists.'] } })
      const auth = makeAuth({ registerBusinessOwner: vi.fn().mockRejectedValue(err) })
      renderFlow(<BusinessRegistrationFlow user={null} auth={auth} prefill={prefill} setPage={vi.fn()} setShowBizDash={vi.fn()} />)
      fireEvent.change(screen.getByPlaceholderText(/Password/), { target: { value: 'longenough1' } })
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      expect(await screen.findByText('A business account with this phone number already exists.')).toBeInTheDocument()
    })

    it('still shows the generic text when the server sends no message', async () => {
      const auth = makeAuth({ registerBusinessOwner: vi.fn().mockRejectedValue(new Error('network')) })
      renderFlow(<BusinessRegistrationFlow user={null} auth={auth} setPage={vi.fn()} setShowBizDash={vi.fn()} />)
      fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Kofi' } })
      fireEvent.change(screen.getByPlaceholderText(/Phone/), { target: { value: '0200000000' } })
      fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'kofi@example.com' } })
      fireEvent.change(screen.getByPlaceholderText(/Password/), { target: { value: 'longenough1' } })
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      expect(await screen.findByText('Could not create your account. Please check your details.')).toBeInTheDocument()
    })
  })
})
