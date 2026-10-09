import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import CheckInPanel from '../CheckInPanel.jsx'

// A device whose single reading is whatever the test sets: locate() delivers
// it (or the error) at once, like a phone answering.
const device = vi.hoisted(() => ({ fix: null, error: null, locate: vi.fn() }))
vi.mock('../../../../hooks/useDevicePosition.js', async () => {
  const React = await import('react')
  return {
    useDevicePosition: () => {
      const [state, setState] = React.useState({ position: null, error: null })
      const locate = React.useCallback(() => {
        device.locate()
        setState(device.error
          ? { position: null, error: device.error }
          : { position: { ...device.fix, at: new Date().toISOString() }, error: null })
      }, [])
      return { ...state, locating: false, locate }
    },
  }
})

const API = 'http://localhost:8000'
const PIN = { lat: 6.6885, lng: -1.6244 }
// metres → degrees of latitude
const north = (m) => PIN.lat + m / 111195
const TARGETS = [
  { kind: 'business', business_owner: 12, scout_assignment: null, business_id: 12, name: 'Adwoa Fabrics', area: 'Bantama', lat: PIN.lat, lng: PIN.lng, has_pin: true },
  { kind: 'business', business_owner: 14, scout_assignment: null, business_id: 14, name: 'Far Away Shop', area: 'Asafo', lat: PIN.lat + 0.05, lng: PIN.lng, has_pin: true },
  { kind: 'business', business_owner: 15, scout_assignment: null, business_id: 15, name: 'Pinless Stores', area: null, lat: null, lng: null, has_pin: false },
  { kind: 'verification', business_owner: null, scout_assignment: 4, business_id: 30, name: "Yaw's Garage", area: 'Suame', lat: PIN.lat + 0.001, lng: PIN.lng, has_pin: true },
]
const openVisit = (overrides = {}) => ({
  id: 5, status: 'open', purpose: 'subscription_follow_up', purpose_label: 'Subscription follow-up',
  business: { id: 12, name: 'Adwoa Fabrics', area: 'Bantama', has_pin: true }, scout_assignment_id: null,
  checked_in_at: new Date(Date.now() - 14 * 60000).toISOString(), checked_out_at: null, minutes: null,
  distance_m: 38, outside_radius: false, radius_m: 100, accuracy_m: 9, fix: { lat: north(38), lng: PIN.lng },
  pin: { lat: PIN.lat, lng: PIN.lng }, notes: '', photos: [], ...overrides,
})

function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <CheckInPanel onBack={() => {}} {...props} />
    </QueryClientProvider>,
  )
  return queryClient
}
const useTargets = (targets = TARGETS) => server.use(http.get(`${API}/api/field/visit-targets/`, () => HttpResponse.json(targets)))
const useOpen = (visit) => server.use(http.get(`${API}/api/field/visits/open/`, () => HttpResponse.json({ visit })))

beforeEach(() => {
  device.fix = { lat: north(0), lng: PIN.lng, accuracy: 12 }
  device.error = null
  device.locate.mockClear()
})

describe('CheckInPanel — step A, picking where you are', () => {
  it('reads no location until the scout taps, then lists the nearest places with distances', async () => {
    useTargets()
    renderPanel()
    expect(await screen.findByRole('button', { name: 'Use my location' })).toBeInTheDocument()
    expect(device.locate).not.toHaveBeenCalled()
    expect(screen.queryByText('Nearest places')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }))
    expect(device.locate).toHaveBeenCalledTimes(1)
    const group = await screen.findByRole('radiogroup')
    const names = within(group).getAllByRole('radio').map((r) => r.closest('label').textContent)
    expect(names[0]).toContain('Adwoa Fabrics')
    expect(names[0]).toContain('0 m')
    expect(names[1]).toContain("Yaw's Garage")
    expect(names[1]).toContain('111 m')
    expect(names[2]).toContain('Far Away Shop')
    expect(names[2]).toContain('5.6 km')
    expect(names[3]).toContain('Pinless Stores')
    expect(names[3]).toContain('No pin')
    expect(screen.getByText('📍 Location found · accurate to about 12 m')).toBeInTheDocument()
  })

  it('checks in with the fix and the chosen purpose', async () => {
    useTargets()
    const bodies = []
    server.use(http.post(`${API}/api/field/visits/`, async ({ request }) => {
      bodies.push(await request.json())
      return HttpResponse.json(openVisit(), { status: 201 })
    }))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }))
    fireEvent.click(await screen.findByRole('radio', { name: /Adwoa Fabrics/ }))
    const submit = screen.getByRole('button', { name: 'Check in at Adwoa Fabrics' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Purpose of the visit'), { target: { value: 'subscription_follow_up' } })
    useOpen(openVisit())
    fireEvent.click(submit)
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({
      business_owner: 12, purpose: 'subscription_follow_up', lat: north(0), lng: PIN.lng, accuracy_m: 12,
    })
    expect(await screen.findByText(/Checked in/)).toBeInTheDocument()
  })

  it('sends a verification place as its assignment, with no purpose to choose', async () => {
    useTargets()
    const bodies = []
    server.use(http.post(`${API}/api/field/visits/`, async ({ request }) => {
      bodies.push(await request.json())
      return HttpResponse.json(openVisit({ scout_assignment_id: 4, purpose: 'verification' }), { status: 201 })
    }))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }))
    fireEvent.click(await screen.findByRole('radio', { name: /Yaw's Garage/ }))
    expect(screen.getByLabelText('Purpose of the visit')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: "Check in at Yaw's Garage" }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ scout_assignment: 4, purpose: 'verification' })
    expect(bodies[0].business_owner).toBeUndefined()
  })

  it('checks in at a prospect by its id, and says the first check-in sets its pin', async () => {
    useTargets([
      ...TARGETS,
      { kind: 'prospect', business_owner: null, scout_assignment: null, prospect: 8, business_id: null, name: 'Ohemaa Waakye Joint', area: 'Asafo', lat: null, lng: null, has_pin: false },
    ])
    const bodies = []
    server.use(http.post(`${API}/api/field/visits/`, async ({ request }) => {
      bodies.push(await request.json())
      return HttpResponse.json(openVisit({ business: null, prospect: { id: 8, name: 'Ohemaa Waakye Joint', area: 'Asafo', has_pin: true }, distance_m: null, pin: { lat: PIN.lat, lng: PIN.lng } }), { status: 201 })
    }))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }))
    fireEvent.click(await screen.findByRole('radio', { name: /Ohemaa Waakye Joint/ }))
    expect(screen.getByText(/This prospect has no map pin yet/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Purpose of the visit'), { target: { value: 'prospecting' } })
    useOpen(openVisit({ business: null, prospect: { id: 8, name: 'Ohemaa Waakye Joint', area: 'Asafo', has_pin: true }, distance_m: null }))
    fireEvent.click(screen.getByRole('button', { name: 'Check in at Ohemaa Waakye Joint' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ prospect: 8, purpose: 'prospecting' })
    expect(bodies[0].business_owner).toBeUndefined()
    expect(await screen.findByText("This check-in is now this prospect's map pin. Later visits are measured from it.")).toBeInTheDocument()
  })

  it('pre-selects the business the scout came from', async () => {
    useTargets()
    renderPanel({ presetBusinessId: 15 })
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }))
    expect(await screen.findByRole('radio', { name: /Pinless Stores/ })).toBeChecked()
  })

  it('says the distance cannot be measured when the business has no pin', async () => {
    useTargets()
    renderPanel({ presetBusinessId: 15 })
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }))
    expect(await screen.findByText("No map pin for this business yet, so the distance can't be measured.")).toBeInTheDocument()
  })

  it('warns, without blocking, when the scout is far from the pin', async () => {
    useTargets()
    device.fix = { lat: north(500), lng: PIN.lng, accuracy: 10 }
    renderPanel({ presetBusinessId: 12 })
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }))
    expect(await screen.findByText(/You are about 500 m from the pin\. You can still check in/)).toBeInTheDocument()
  })

  it('refuses a rough fix and asks the scout to try again', async () => {
    useTargets()
    device.fix = { lat: north(0), lng: PIN.lng, accuracy: 450 }
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('rough (about 450 m)')
    expect(screen.queryByRole('button', { name: /^Check in at/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Read my location again' })).toBeInTheDocument()
  })

  it('explains how to switch location on when it is denied, and offers no check-in', async () => {
    useTargets()
    device.error = 'Location is blocked for AshantiHub on this phone. To allow it, tap the lock.'
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Location is blocked')
    expect(screen.queryByText('Nearest places')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it("shows the server's refusal when a visit is already open", async () => {
    useTargets()
    server.use(http.post(`${API}/api/field/visits/`, () => HttpResponse.json({ detail: 'Check out of Nana\'s Chop Bar first' }, { status: 409 })))
    renderPanel({ presetBusinessId: 12 })
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }))
    fireEvent.change(await screen.findByLabelText('Purpose of the visit'), { target: { value: 'prospecting' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check in at Adwoa Fabrics' }))
    expect(await screen.findByText("Check out of Nana's Chop Bar first")).toBeInTheDocument()
  })

  it('always shows the location rule', async () => {
    useTargets()
    renderPanel()
    expect(await screen.findByText(/read only at check-in, check-out and when you take a photo — never in between/)).toBeInTheDocument()
  })
})

describe('CheckInPanel — step B, the open visit', () => {
  it('shows the business, how long ago, the distance, the map and the pieces of the visit', async () => {
    useOpen(openVisit())
    renderPanel()
    expect(await screen.findByRole('heading', { name: 'Adwoa Fabrics' })).toBeInTheDocument()
    expect(screen.getByText(/● Checked in \d\d:\d\d · 14 min/)).toBeInTheDocument()
    expect(screen.getByText('✓ 38 m from the business pin')).toBeInTheDocument()
    expect(screen.getByTestId('visit-map')).toHaveAccessibleName(/38 metres from the Adwoa Fabrics pin, inside the 100 metre circle/)
    expect(screen.getByLabelText('Purpose of the visit')).toHaveValue('subscription_follow_up')
    expect(screen.getByLabelText('Notes')).toBeInTheDocument()
    expect(screen.getByText(/Take photo/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check out' })).toBeInTheDocument()
  })

  it('says saved and flagged when outside the radius, and that the visit still counts', async () => {
    useOpen(openVisit({ distance_m: 180, outside_radius: true }))
    renderPanel()
    expect(await screen.findByText('🚩 Outside the 100 m radius — saved and flagged')).toBeInTheDocument()
    expect(screen.getByText(/180 m from the pin\. The visit still counts/)).toBeInTheDocument()
    expect(screen.getByText(/Three flagged check-ins in 7 days open a review by Operations/)).toBeInTheDocument()
  })

  it("says the distance can't be measured, and draws no map, when there is no pin", async () => {
    useOpen(openVisit({ distance_m: null, pin: null, business: { id: 12, name: 'Adwoa Fabrics', area: null, has_pin: false } }))
    renderPanel()
    expect(await screen.findByText("No map pin for this business yet, so the distance can't be measured.")).toBeInTheDocument()
    expect(screen.queryByTestId('visit-map')).not.toBeInTheDocument()
  })

  it('checks out with a fresh location and the notes, then goes back', async () => {
    useOpen(openVisit())
    const bodies = []
    server.use(http.post(`${API}/api/field/visits/5/check-out/`, async ({ request }) => {
      bodies.push(await request.json())
      return HttpResponse.json(openVisit({ status: 'done' }))
    }))
    const onBack = vi.fn()
    renderPanel({ onBack })
    fireEvent.change(await screen.findByLabelText('Notes'), { target: { value: 'Paid on Friday.' } })
    device.fix = { lat: north(30), lng: PIN.lng, accuracy: 8 }
    expect(device.locate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Check out' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(device.locate).toHaveBeenCalledTimes(1)
    expect(bodies[0]).toEqual({ lat: north(30), lng: PIN.lng, accuracy_m: 8, notes: 'Paid on Friday.' })
    await waitFor(() => expect(onBack).toHaveBeenCalled())
  })

  it('stays open and shows the reason when check-out is refused', async () => {
    useOpen(openVisit())
    server.use(http.post(`${API}/api/field/visits/5/check-out/`, () => HttpResponse.json({ detail: 'Location is needed to check out' }, { status: 400 })))
    const onBack = vi.fn()
    renderPanel({ onBack })
    fireEvent.click(await screen.findByRole('button', { name: 'Check out' }))
    expect(await screen.findByText('Location is needed to check out')).toBeInTheDocument()
    expect(onBack).not.toHaveBeenCalled()
  })

  it('refuses a rough fix at check-out without calling the server, and offers Try again', async () => {
    useOpen(openVisit())
    let posted = false
    server.use(http.post(`${API}/api/field/visits/5/check-out/`, () => { posted = true; return HttpResponse.json(openVisit()) }))
    const bodies = []
    renderPanel()
    device.fix = { lat: north(0), lng: PIN.lng, accuracy: 450 }
    fireEvent.click(await screen.findByRole('button', { name: 'Check out' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('rough (about 450 m)')
    expect(posted).toBe(false)
    server.use(http.post(`${API}/api/field/visits/5/check-out/`, async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json(openVisit({ status: 'done' })) }))
    device.fix = { lat: north(0), lng: PIN.lng, accuracy: 12 }
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].accuracy_m).toBe(12)
  })

  it('does not check out when the location is denied', async () => {
    useOpen(openVisit())
    device.error = 'Location is blocked for AshantiHub on this phone.'
    let posted = false
    server.use(http.post(`${API}/api/field/visits/5/check-out/`, () => { posted = true; return HttpResponse.json(openVisit()) }))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Check out' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Location is blocked')
    expect(posted).toBe(false)
  })

  it('saves a changed purpose at once', async () => {
    useOpen(openVisit())
    const bodies = []
    server.use(http.patch(`${API}/api/field/visits/5/`, async ({ request }) => {
      bodies.push(await request.json())
      return HttpResponse.json(openVisit({ purpose: 'info_update' }))
    }))
    renderPanel()
    fireEvent.change(await screen.findByLabelText('Purpose of the visit'), { target: { value: 'info_update' } })
    await waitFor(() => expect(bodies).toEqual([{ purpose: 'info_update' }]))
  })

  it('locks the purpose of a verification visit', async () => {
    useOpen(openVisit({ scout_assignment_id: 4, purpose: 'verification', purpose_label: 'Verification' }))
    renderPanel()
    expect(await screen.findByLabelText('Purpose of the visit')).toBeDisabled()
  })

  it('shows photos already taken at this visit', async () => {
    useOpen(openVisit({ photos: [{ id: 1, url: 'http://localhost:8000/media/a.jpg', taken_at: '2026-10-07T11:09:00Z' }] }))
    renderPanel()
    expect(await screen.findByAltText('Photo 1')).toBeInTheDocument()
    // The chip shows the capture time as HH:MM (24 h), not a date.
    expect(within(screen.getByRole('list', { name: 'Photos taken' })).getByText(/^\d\d:\d\d$/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove photo/ })).not.toBeInTheDocument()
  })

  it('uploads a photo to the visit, stamped with the position read when the camera opened', async () => {
    useOpen(openVisit())
    let uploaded = null
    server.use(http.post(`${API}/api/field/visits/5/photos/`, async () => {
      uploaded = true
      return HttpResponse.json({ id: 9, url: 'http://localhost:8000/media/b.jpg', taken_at: '2026-10-07T11:10:00Z' }, { status: 201 })
    }))
    const appended = []
    const original = FormData.prototype.append
    vi.spyOn(FormData.prototype, 'append').mockImplementation(function (name, value, ...rest) {
      appended.push([name, typeof value === 'string' ? value : 'file'])
      return original.call(this, name, value, ...rest)
    })
    renderPanel()
    await screen.findByText(/Take photo/)
    const input = document.querySelector('input[type="file"]')
    fireEvent.click(input)
    expect(device.locate).toHaveBeenCalledTimes(1)
    fireEvent.change(input, { target: { files: [new File(['x'], 'shop.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(uploaded).toBe(true))
    expect(appended.map(([name]) => name)).toEqual(expect.arrayContaining(['image', 'lat', 'lng', 'accuracy_m']))
    vi.restoreAllMocks()
  })
})
