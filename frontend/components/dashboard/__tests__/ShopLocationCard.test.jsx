import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import ShopLocationCard from '../ShopLocationCard.jsx'

const URL = 'http://localhost:8000/api/accounts/me/location/'
const pin = (overrides = {}) => ({ lat: '6.688500', lng: '-1.624400', accuracy_m: 18, set_by: 'owner', set_at: '2026-10-30T10:21:00Z', is_manual: false, ...overrides })
const state = (overrides = {}) => ({ pin: null, address_status: 'not_verified', wrong_reason: null, can_capture: true, ...overrides })
const fix = (accuracy, lat = 6.6885, lng = -1.6244) => ({ coords: { latitude: lat, longitude: lng, accuracy }, timestamp: Date.parse('2026-10-30T10:21:00Z') })

function stubGeolocation(getCurrentPosition) {
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: getCurrentPosition ? { getCurrentPosition } : undefined })
}

// GET answers the current state; a POST (when `onPost` is given) records the body and may change the state.
function serve(initial, { onPost } = {}) {
  let current = initial
  const seen = { gets: 0, posts: [] }
  server.use(
    http.get(URL, () => { seen.gets += 1; return HttpResponse.json(current) }),
    http.post(URL, async ({ request }) => {
      const body = await request.json()
      seen.posts.push(body)
      const result = onPost ? onPost(body, (next) => { current = next }) : null
      return result || HttpResponse.json(current)
    }),
  )
  return seen
}

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><ShopLocationCard /></QueryClientProvider>)
}
const capture = () => fireEvent.click(screen.getByRole('button', { name: "I'm at my shop — use my location" }))

afterEach(() => {
  delete navigator.geolocation
  delete window.isSecureContext
  vi.restoreAllMocks()
})

describe('ShopLocationCard', () => {
  it('asks for the shop location when there is no pin, says why, and tells a laptop user to use a phone', async () => {
    stubGeolocation(vi.fn())
    serve(state())
    renderCard()
    expect(await screen.findByRole('heading', { name: 'Add your shop location' })).toBeInTheDocument()
    expect(screen.getByText(/customers and riders find your shop/i)).toBeInTheDocument()
    expect(screen.getByText(/AshantiHub checks it/i)).toBeInTheDocument()
    expect(screen.getByText(/from your phone, while you are at your shop/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "I'm at my shop — use my location" })).toBeInTheDocument()
  })

  it('takes one reading, posts it, refetches and then shows the pin as not verified yet', async () => {
    const getCurrentPosition = vi.fn((ok) => ok(fix(18.2)))
    stubGeolocation(getCurrentPosition)
    const seen = serve(state(), { onPost: (_body, set) => { set(state({ pin: pin({ accuracy_m: 19 }) })) } })
    renderCard()
    await screen.findByRole('heading', { name: 'Add your shop location' })
    capture()
    expect(await screen.findByText('Address not verified yet')).toBeInTheDocument()
    expect(seen.posts).toEqual([{ lat: 6.6885, lng: -1.6244, accuracy_m: 19 }])
    expect(seen.gets).toBe(2) // the first load, then the refetch after saving
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(getCurrentPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 })
    expect(screen.getByText(/±19 m/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Your shop on the map' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Add your shop location' })).not.toBeInTheDocument()
  })

  it('refuses a coarse fix on the phone: says so, sends nothing, and offers another try', async () => {
    const getCurrentPosition = vi.fn((ok) => ok(fix(240.4)))
    stubGeolocation(getCurrentPosition)
    const seen = serve(state())
    renderCard()
    await screen.findByRole('heading', { name: 'Add your shop location' })
    capture()
    expect(await screen.findByText(/only accurate to ±241 m. We need 100 m or better/)).toBeInTheDocument()
    expect(seen.posts).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(getCurrentPosition).toHaveBeenCalledTimes(2)
    expect(seen.posts).toEqual([])
  })

  it('says plainly that location is blocked, with no hand-placed pin offered', async () => {
    stubGeolocation(vi.fn((_ok, fail) => fail({ code: 1 })))
    const seen = serve(state())
    renderCard()
    await screen.findByRole('heading', { name: 'Add your shop location' })
    capture()
    expect(await screen.findByText(/Location is blocked for AshantiHub on this phone/)).toBeInTheDocument()
    expect(screen.queryByText(/by hand/i)).not.toBeInTheDocument()
    expect(seen.posts).toEqual([])
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('has its own honest text when the browser cannot share a location at all', async () => {
    stubGeolocation(undefined)
    serve(state())
    renderCard()
    await screen.findByRole('heading', { name: 'Add your shop location' })
    capture()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/can't share its location/)
    expect(alert).toHaveTextContent(/phone/)
    expect(alert).not.toHaveTextContent(/by hand/i)
  })

  it('explains an insecure page instead of asking the browser', async () => {
    const getCurrentPosition = vi.fn()
    stubGeolocation(getCurrentPosition)
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    serve(state())
    renderCard()
    await screen.findByRole('heading', { name: 'Add your shop location' })
    expect(screen.getByRole('alert')).toHaveTextContent(/secure pages \(https\)/)
    expect(screen.queryByRole('button', { name: "I'm at my shop — use my location" })).not.toBeInTheDocument()
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('shows the server sentence for a fix it will not take', async () => {
    stubGeolocation(vi.fn((ok) => ok(fix(30))))
    serve(state(), { onPost: () => HttpResponse.json({ lat: ["This location isn't in the Ashanti Region. Share it from your shop."] }, { status: 400 }) })
    renderCard()
    await screen.findByRole('heading', { name: 'Add your shop location' })
    capture()
    expect(await screen.findByText("This location isn't in the Ashanti Region. Share it from your shop.")).toBeInTheDocument()
  })

  it('shows the verified message when the server says the location is already verified, and then no capture button', async () => {
    stubGeolocation(vi.fn((ok) => ok(fix(30))))
    const message = "Your shop's location is verified. To change it, contact AshantiHub Support."
    const seen = serve(state(), {
      onPost: (_body, set) => {
        set(state({ pin: pin(), address_status: 'verified', can_capture: false }))
        return HttpResponse.json({ detail: message, code: 'address_verified' }, { status: 409 })
      },
    })
    renderCard()
    await screen.findByRole('heading', { name: 'Add your shop location' })
    capture()
    expect(await screen.findByText('Verified')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(seen.posts).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /use my location/i })).not.toBeInTheDocument()
  })

  it('shows a 409 message verbatim', async () => {
    stubGeolocation(vi.fn((ok) => ok(fix(30))))
    serve(state(), { onPost: () => HttpResponse.json({ detail: 'Your application was rejected. Fix and resubmit first.', code: 'kyc_rejected' }, { status: 409 }) })
    renderCard()
    await screen.findByRole('heading', { name: 'Add your shop location' })
    capture()
    expect(await screen.findByText('Your application was rejected. Fix and resubmit first.')).toBeInTheDocument()
  })

  it('verified: shows the status, accuracy and date, points to Support to change it, and offers no capture', async () => {
    stubGeolocation(vi.fn())
    serve(state({ pin: pin(), address_status: 'verified', can_capture: false }))
    renderCard()
    expect(await screen.findByText('Verified')).toBeInTheDocument()
    expect(screen.getByText(/±18 m/)).toBeInTheDocument()
    expect(screen.getByText(/30 Oct 2026/)).toBeInTheDocument()
    expect(screen.getByText(/contact AshantiHub Support/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /use my location/i })).not.toBeInTheDocument()
  })

  it('wrong: shows AshantiHub\'s reason and a re-share button that posts a new fix', async () => {
    const getCurrentPosition = vi.fn((ok) => ok(fix(25, 6.69, -1.62)))
    stubGeolocation(getCurrentPosition)
    const seen = serve(
      state({ pin: pin(), address_status: 'wrong', wrong_reason: 'The pin is on the next street.', can_capture: true }),
      { onPost: (_b, set) => { set(state({ pin: pin({ accuracy_m: 25 }) })) } },
    )
    renderCard()
    expect(await screen.findByText("AshantiHub couldn't confirm this location")).toBeInTheDocument()
    expect(screen.getByText(/The pin is on the next street\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: "I'm at my shop — share my location again" }))
    expect(await screen.findByText('Address not verified yet')).toBeInTheDocument()
    expect(seen.posts).toEqual([{ lat: 6.69, lng: -1.62, accuracy_m: 25 }])
  })

  it('not verified with a pin: offers no re-share when the server says it cannot capture', async () => {
    stubGeolocation(vi.fn())
    serve(state({ pin: pin(), can_capture: false }))
    renderCard()
    expect(await screen.findByText('Address not verified yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /use my location|share my location again/i })).not.toBeInTheDocument()
  })

  it('shows a plain error, not an empty prompt, when the state cannot be loaded', async () => {
    stubGeolocation(vi.fn())
    server.use(http.get(URL, () => HttpResponse.json({ detail: 'boom' }, { status: 500 })))
    renderCard()
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn't load your shop location/)
    expect(screen.queryByRole('button', { name: /use my location/i })).not.toBeInTheDocument()
  })

  it('does not call the server again when the same fix is posted once', async () => {
    stubGeolocation(vi.fn((ok) => ok(fix(18))))
    const seen = serve(state(), { onPost: (_b, set) => { set(state({ pin: pin() })) } })
    renderCard()
    await screen.findByRole('heading', { name: 'Add your shop location' })
    capture()
    await screen.findByText('Address not verified yet')
    await waitFor(() => expect(seen.posts).toHaveLength(1))
  })
})
