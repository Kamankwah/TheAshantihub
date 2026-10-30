import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getStoredAuth, setStoredAuth } from '../../apiClient.js'
import { server } from '../../mocks/server.js'
import ShareLocationPage from '../ShareLocationPage.jsx'

const API = 'http://localhost:8000/api/accounts/location-links'
const live = () => ({ business_name: "Akosua's Kitchen", valid: true, expires_at: new Date(Date.now() + 2 * 86400000).toISOString() })
const refuse = (status, code, detail = 'x') => () => HttpResponse.json({ detail, code }, { status })
const fix = (accuracy, lat = 6.6885, lng = -1.6244) => ({ coords: { latitude: lat, longitude: lng, accuracy }, timestamp: Date.parse('2026-10-30T10:21:00Z') })

function stubGeolocation(getCurrentPosition) {
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: getCurrentPosition ? { getCurrentPosition } : undefined })
}
function renderAt(url = '/share-location#token=raw-tok_1') {
  window.history.replaceState(null, '', url)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><ShareLocationPage /></QueryClientProvider>)
}
const share = () => fireEvent.click(screen.getByRole('button', { name: 'Use my location' }))

afterEach(() => {
  delete navigator.geolocation
  delete window.isSecureContext
  setStoredAuth(null)
  window.history.replaceState(null, '', '/')
  vi.restoreAllMocks()
})

describe('ShareLocationPage', () => {
  it('shows the business and the consent line, and asks for nothing until the button is tapped', async () => {
    const getCurrentPosition = vi.fn()
    stubGeolocation(getCurrentPosition)
    let body = null
    server.use(http.post(`${API}/preview/`, async ({ request }) => { body = await request.json(); return HttpResponse.json(live()) }))
    renderAt()
    expect(await screen.findByRole('heading', { name: "Akosua's Kitchen" })).toBeInTheDocument()
    expect(screen.getByText(/Share this device's location so AshantiHub can place your shop on the map/)).toBeInTheDocument()
    expect(body).toEqual({ token: 'raw-tok_1' })
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('takes one high-accuracy reading, shows its accuracy, posts it and then says staff will check it', async () => {
    const getCurrentPosition = vi.fn((ok) => ok(fix(18.2)))
    stubGeolocation(getCurrentPosition)
    let sent = null
    const auth = []
    server.use(
      http.post(`${API}/preview/`, () => HttpResponse.json(live())),
      http.post(`${API}/capture/`, async ({ request }) => {
        sent = await request.json()
        auth.push(request.headers.get('authorization'))
        return HttpResponse.json({ business_name: "Akosua's Kitchen", accuracy_m: 19, captured_at: '2026-10-30T10:21:05Z' })
      }),
    )
    setStoredAuth({ token: 'stored-session-token', account_type: 'staff', id: 1 })
    renderAt()
    await screen.findByRole('heading', { name: "Akosua's Kitchen" })
    share()
    const status = await screen.findByText(/AshantiHub staff will check it/)
    expect(status).toHaveTextContent("Akosua's Kitchen")
    expect(screen.getByText('±19 m')).toBeInTheDocument()
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(getCurrentPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 })
    expect(sent).toEqual({ token: 'raw-tok_1', lat: 6.6885, lng: -1.6244, accuracy_m: 19 })
    expect(auth).toEqual([null]) // no stored session is sent
    expect(getStoredAuth()).not.toBeNull() // and none is ended
    expect(screen.queryByRole('button', { name: /Use my location|Try again/ })).not.toBeInTheDocument()
    // no coordinates are shown to the owner
    expect(document.body.textContent).not.toContain('6.6885')
  })

  it('refuses a fix worse than 100 m without posting, and a second try can succeed', async () => {
    const readings = [fix(250.2), fix(30)]
    const getCurrentPosition = vi.fn((ok) => ok(readings.shift()))
    stubGeolocation(getCurrentPosition)
    let captures = 0
    server.use(
      http.post(`${API}/preview/`, () => HttpResponse.json(live())),
      http.post(`${API}/capture/`, () => { captures += 1; return HttpResponse.json({ business_name: "Akosua's Kitchen", accuracy_m: 30, captured_at: 'x' }) }),
    )
    renderAt()
    await screen.findByRole('heading', { name: "Akosua's Kitchen" })
    share()
    expect(await screen.findByRole('alert')).toHaveTextContent(/only accurate to ±251 m.*100 m or better.*try again/i)
    expect(captures).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/AshantiHub staff will check it/)).toBeInTheDocument()
    expect(captures).toBe(1)
    expect(getCurrentPosition).toHaveBeenCalledTimes(2)
  })

  it('accepts a fix of exactly 100 m once the owner chooses to save it', async () => {
    stubGeolocation(vi.fn((ok) => ok(fix(100))))
    let sent = null
    server.use(
      http.post(`${API}/preview/`, () => HttpResponse.json(live())),
      http.post(`${API}/capture/`, async ({ request }) => { sent = await request.json(); return HttpResponse.json({ business_name: 'B', accuracy_m: 100, captured_at: 'x' }) }),
    )
    renderAt()
    await screen.findByRole('heading', { name: "Akosua's Kitchen" })
    share()
    fireEvent.click(await screen.findByRole('button', { name: 'Save this one anyway' }))
    await screen.findByText(/AshantiHub staff will check it/)
    expect(sent.accuracy_m).toBe(100)
  })

  it('posts a fix of exactly 50 m straight away', async () => {
    stubGeolocation(vi.fn((ok) => ok(fix(50))))
    let sent = null
    server.use(
      http.post(`${API}/preview/`, () => HttpResponse.json(live())),
      http.post(`${API}/capture/`, async ({ request }) => { sent = await request.json(); return HttpResponse.json({ business_name: 'B', accuracy_m: 50, captured_at: 'x' }) }),
    )
    renderAt()
    await screen.findByRole('heading', { name: "Akosua's Kitchen" })
    share()
    await screen.findByText(/AshantiHub staff will check it/)
    expect(sent.accuracy_m).toBe(50)
  })

  it('warns about a 51 m fix and posts nothing until "Save this one anyway"; Try again re-locates', async () => {
    const readings = [fix(50.4), fix(30)]
    const getCurrentPosition = vi.fn((ok) => ok(readings.shift()))
    stubGeolocation(getCurrentPosition)
    const sent = []
    server.use(
      http.post(`${API}/preview/`, () => HttpResponse.json(live())),
      http.post(`${API}/capture/`, async ({ request }) => { sent.push(await request.json()); return HttpResponse.json({ business_name: 'B', accuracy_m: 51, captured_at: 'x' }) }),
    )
    renderAt()
    await screen.findByRole('heading', { name: "Akosua's Kitchen" })
    share()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your location is accurate to ±51 m. AshantiHub needs 50 m or better to verify your shop: step outside and try again.',
    )
    expect(sent).toEqual([])
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save this one anyway' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText(/AshantiHub staff will check it/)
    expect(getCurrentPosition).toHaveBeenCalledTimes(2)
    expect(sent).toHaveLength(1)
    expect(sent[0].accuracy_m).toBe(30)
  })

  it('"Save this one anyway" posts the 51 m fix', async () => {
    stubGeolocation(vi.fn((ok) => ok(fix(75))))
    const sent = []
    server.use(
      http.post(`${API}/preview/`, () => HttpResponse.json(live())),
      http.post(`${API}/capture/`, async ({ request }) => { sent.push(await request.json()); return HttpResponse.json({ business_name: 'B', accuracy_m: 75, captured_at: 'x' }) }),
    )
    renderAt()
    await screen.findByRole('heading', { name: "Akosua's Kitchen" })
    share()
    await screen.findByRole('button', { name: 'Save this one anyway' })
    expect(sent).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Save this one anyway' }))
    await screen.findByText(/AshantiHub staff will check it/)
    expect(sent).toEqual([{ token: 'raw-tok_1', lat: 6.6885, lng: -1.6244, accuracy_m: 75 }])
  })

  it('tells a phone that is hundreds of metres off to turn on Precise location', async () => {
    stubGeolocation(vi.fn((ok) => ok(fix(1800))))
    server.use(http.post(`${API}/preview/`, () => HttpResponse.json(live())))
    renderAt()
    await screen.findByRole('heading', { name: "Akosua's Kitchen" })
    share()
    expect(await screen.findByRole('alert')).toHaveTextContent(/turn on Precise location for your browser in your phone's settings/i)
  })

  it('says how to unblock location when permission is denied, posts nothing, and offers another try', async () => {
    stubGeolocation(vi.fn((_ok, fail) => fail({ code: 1 })))
    let captures = 0
    server.use(
      http.post(`${API}/preview/`, () => HttpResponse.json(live())),
      http.post(`${API}/capture/`, () => { captures += 1; return HttpResponse.json({}) }),
    )
    renderAt()
    await screen.findByRole('heading', { name: "Akosua's Kitchen" })
    share()
    expect(await screen.findByRole('alert')).toHaveTextContent(/Location is blocked for AshantiHub/)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(captures).toBe(0)
  })

  it('has honest copy for a slow phone and for a phone that cannot find itself', async () => {
    const fails = [{ code: 3 }, { code: 2 }]
    stubGeolocation(vi.fn((_ok, fail) => fail(fails.shift())))
    server.use(http.post(`${API}/preview/`, () => HttpResponse.json(live())))
    renderAt()
    await screen.findByRole('heading', { name: "Akosua's Kitchen" })
    share()
    expect(await screen.findByRole('alert')).toHaveTextContent(/in time\. Step outside/)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Turn on Location \(GPS\)/))
  })

  it('does not offer a hand-placed pin when the browser cannot share its location', async () => {
    stubGeolocation(undefined)
    server.use(http.post(`${API}/preview/`, () => HttpResponse.json(live())))
    renderAt()
    await screen.findByRole('heading', { name: "Akosua's Kitchen" })
    share()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/can't share its location/)
    expect(alert.textContent).not.toMatch(/by hand/i)
  })

  it('explains that location needs a secure page when the page is not https, without asking the phone', async () => {
    const getCurrentPosition = vi.fn()
    stubGeolocation(getCurrentPosition)
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    server.use(http.post(`${API}/preview/`, () => HttpResponse.json(live())))
    renderAt()
    expect(await screen.findByRole('alert')).toHaveTextContent(/secure pages \(https\)/)
    expect(screen.queryByRole('button', { name: 'Use my location' })).not.toBeInTheDocument()
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it.each([
    [410, 'expired', /This link has expired.*send you a new one/],
    [410, 'used', /already been used/],
    [410, 'revoked', /newer link has been sent.*newest/],
    [410, 'closed', /can't take a location for this business/],
    [400, 'invalid', /isn't valid/],
  ])('shows an honest message for a %s %s link and no button', async (status, code, text) => {
    stubGeolocation(vi.fn())
    server.use(http.post(`${API}/preview/`, refuse(status, code)))
    renderAt()
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says the link is missing its code, and calls nothing, when there is no token', async () => {
    let called = false
    server.use(http.post(`${API}/preview/`, () => { called = true; return HttpResponse.json(live()) }))
    renderAt('/share-location')
    expect(await screen.findByRole('alert')).toHaveTextContent(/missing its code/)
    expect(called).toBe(false)
  })

  it('ignores a ?token= query: the location link is only ever read from the fragment', async () => {
    let called = false
    server.use(http.post(`${API}/preview/`, () => { called = true; return HttpResponse.json(live()) }))
    renderAt('/share-location?token=nope')
    expect(await screen.findByRole('alert')).toHaveTextContent(/missing its code/)
    expect(called).toBe(false)
  })

  it('shows the server sentence for a fix it refuses (accuracy) and lets the owner try again', async () => {
    stubGeolocation(vi.fn((ok) => ok(fix(40))))
    const detail = "Your phone's location is only accurate to ±120 m. We need 100 m or better: step outside or near a window and try again."
    server.use(
      http.post(`${API}/preview/`, () => HttpResponse.json(live())),
      http.post(`${API}/capture/`, () => HttpResponse.json({ accuracy_m: [detail] }, { status: 400 })),
    )
    renderAt()
    await screen.findByRole('heading', { name: "Akosua's Kitchen" })
    share()
    expect(await screen.findByRole('alert')).toHaveTextContent(detail)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('shows the server sentence for a location outside the Ashanti Region', async () => {
    stubGeolocation(vi.fn((ok) => ok(fix(20, 5.6, -0.19))))
    const detail = "This location isn't in the Ashanti Region. Share it from your shop."
    server.use(
      http.post(`${API}/preview/`, () => HttpResponse.json(live())),
      http.post(`${API}/capture/`, () => HttpResponse.json({ lat: [detail] }, { status: 400 })),
    )
    renderAt()
    await screen.findByRole('heading', { name: "Akosua's Kitchen" })
    share()
    expect(await screen.findByRole('alert')).toHaveTextContent(detail)
  })

  it('when the link dies between the preview and the capture (used, expired), says so and offers no retry', async () => {
    stubGeolocation(vi.fn((ok) => ok(fix(20))))
    server.use(
      http.post(`${API}/preview/`, () => HttpResponse.json(live())),
      http.post(`${API}/capture/`, refuse(410, 'used')),
    )
    renderAt()
    await screen.findByRole('heading', { name: "Akosua's Kitchen" })
    share()
    expect(await screen.findByRole('alert')).toHaveTextContent(/already been used/)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says the save failed (not that the link is bad) when the server cannot be reached, and retries', async () => {
    stubGeolocation(vi.fn((ok) => ok(fix(20))))
    let first = true
    server.use(
      http.post(`${API}/preview/`, () => HttpResponse.json(live())),
      http.post(`${API}/capture/`, () => {
        if (first) { first = false; return HttpResponse.json({ detail: 'boom' }, { status: 500 }) }
        return HttpResponse.json({ business_name: "Akosua's Kitchen", accuracy_m: 20, captured_at: 'x' })
      }),
    )
    renderAt()
    await screen.findByRole('heading', { name: "Akosua's Kitchen" })
    share()
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't save your location/)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/AshantiHub staff will check it/)).toBeInTheDocument()
  })

  it('reads the token from the fragment, strips it from the address bar and keeps it out of storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    server.use(http.post(`${API}/preview/`, () => HttpResponse.json(live())))
    renderAt('/share-location#token=secret-abc')
    await screen.findByRole('heading', { name: "Akosua's Kitchen" })
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/share-location')
    expect(setItem.mock.calls.flat().join(' ')).not.toContain('secret-abc')
    expect(JSON.stringify({ ...localStorage })).not.toContain('secret-abc')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('secret-abc')
    expect(document.head.querySelector('meta[name="referrer"]')?.content).toBe('no-referrer')
  })

  it('has no way to contact the business', async () => {
    server.use(http.post(`${API}/preview/`, () => HttpResponse.json(live())))
    const { container } = renderAt()
    await screen.findByRole('heading', { name: "Akosua's Kitchen" })
    expect(container.querySelector('a[href^="tel:"], a[href*="wa.me"], a[href^="mailto:"]')).toBeNull()
  })
})
