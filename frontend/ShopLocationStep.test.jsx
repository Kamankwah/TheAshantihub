import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from './mocks/server.js'
import ShopLocationStep from './components/ShopLocationStep.jsx'

const URL = 'http://localhost:8000/api/accounts/me/location/'

const STATE = {
  pin: { lat: 6.69, lng: -1.62, accuracy_m: 20, set_by: 'owner', set_at: '2026-11-06T10:00:00Z', is_manual: false },
  plus_code: '6FM4+PV Kumasi', landmark: '', tier: 'device', tier_label: 'Shared from the shop', is_manual: false,
}

function stubGeolocation(coords) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok) => ok({ coords: { latitude: 6.69, longitude: -1.62, accuracy: 20, ...coords }, timestamp: Date.now() }),
    },
  })
}

afterEach(() => { Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined }) })

// Records every POST body and answers with `reply(body)`.
function capture(reply) {
  const bodies = []
  server.use(http.post(URL, async ({ request }) => {
    const body = await request.json()
    bodies.push(body)
    return reply(body)
  }))
  return bodies
}

function renderStep(auth, onDone = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><ShopLocationStep auth={auth} onDone={onDone} /></QueryClientProvider>)
  return onDone
}

const makeAuth = () => ({ refreshUser: vi.fn().mockResolvedValue({ registration_step: 'plan_selection' }) })

describe('ShopLocationStep', () => {
  it('sends the device fix with its accuracy, shows the plus code, then refreshes the user and moves on', async () => {
    stubGeolocation({})
    const bodies = capture(() => HttpResponse.json(STATE))
    const auth = makeAuth()
    const onDone = renderStep(auth)

    fireEvent.click(screen.getByRole('button', { name: /Use my current location/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save my shop location' }))

    expect(await screen.findByText('6FM4+PV Kumasi')).toBeInTheDocument()
    expect(bodies).toEqual([{ lat: 6.69, lng: -1.62, accuracy_m: 20 }])
    expect(screen.getByText('This is where riders will collect. You can fix it later.')).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ registration_step: 'plan_selection' }))
    expect(auth.refreshUser).toHaveBeenCalledTimes(1)
  })

  it('sends a pin placed by hand as manual, with no accuracy, and the landmark when typed', async () => {
    const bodies = capture(() => HttpResponse.json({ ...STATE, is_manual: true, landmark: 'Opposite the Total filling station' }))
    renderStep(makeAuth())

    fireEvent.change(screen.getByLabelText(/Landmark/), { target: { value: ' Opposite the Total filling station ' } })
    fireEvent.click(screen.getByRole('button', { name: 'drop-pin' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save my shop location' }))

    expect(await screen.findByText('6FM4+PV Kumasi')).toBeInTheDocument()
    expect(bodies).toEqual([{ lat: 6.7, lng: -1.62, manual: true, landmark: 'Opposite the Total filling station' }])
  })

  it('shows the server sentence when the fix is too coarse, and stays on the step', async () => {
    stubGeolocation({ accuracy: 900 })
    capture(() => HttpResponse.json({ accuracy_m: ['Your phone is only accurate to 900 m. Step outside and try again, or place the pin by hand.'] }, { status: 400 }))
    const auth = makeAuth()
    const onDone = renderStep(auth)

    fireEvent.click(screen.getByRole('button', { name: /Use my current location/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save my shop location' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Step outside and try again, or place the pin by hand.')
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
    expect(auth.refreshUser).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('offers no save until a pin has been chosen', () => {
    renderStep(makeAuth())
    expect(screen.getByRole('button', { name: 'Save my shop location' })).toBeDisabled()
  })

  it('says so when the browser cannot share a location, and still lets the pin be placed by hand', () => {
    renderStep(makeAuth())
    fireEvent.click(screen.getByRole('button', { name: /Use my current location/ }))
    expect(screen.getByRole('alert')).toHaveTextContent(/can't share its location/)
    fireEvent.click(screen.getByRole('button', { name: 'drop-pin' }))
    expect(screen.getByRole('button', { name: 'Save my shop location' })).not.toBeDisabled()
  })
})
