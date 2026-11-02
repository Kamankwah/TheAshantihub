import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import DeliverTo from '../DeliverTo.jsx'

const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse'

function setup(props = {}) {
  return render(<QueryClientProvider client={new QueryClient()}><DeliverTo firstName="" savedAddress="" {...props} /></QueryClientProvider>)
}
function position(lat, lng) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (ok) => ok({ coords: { latitude: lat, longitude: lng } }) },
  })
}
const found = (countryCode, country, state) => server.use(http.get(NOMINATIM, () => HttpResponse.json({ address: { country_code: countryCode.toLowerCase(), country, state } })))

describe('DeliverTo', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
  afterEach(() => { delete navigator.geolocation })

  it('opens by itself once per session while nothing is chosen, then stays shut', () => {
    const first = setup()
    expect(screen.getByRole('dialog', { name: /delivery location/i })).toBeInTheDocument()
    first.unmount()
    setup()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Choose location')).toBeInTheDocument()
  })

  it('detects Accra, asks "Deliver to Accra?" and remembers the yes', async () => {
    position(5.6, -0.19)
    found('GH', 'Ghana', 'Greater Accra Region')
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Use my current location' }))
    expect(await screen.findByRole('heading', { name: 'Deliver to Accra?' })).toBeInTheDocument()
    expect(screen.getByTestId('deliver-note')).toHaveTextContent(/Ashanti Region only/)
    fireEvent.click(screen.getByRole('button', { name: 'Yes, deliver to Accra' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Accra')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('ashantihub.deliverTo'))).toEqual({ countryCode: 'GH', region: 'Greater Accra' })
  })

  it('names the country when the shopper is outside Ghana', async () => {
    position(51.5, -0.12)
    found('GB', 'United Kingdom', 'England')
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Use my current location' }))
    expect(await screen.findByRole('heading', { name: 'Deliver to United Kingdom?' })).toBeInTheDocument()
    expect(screen.getByTestId('deliver-note')).toHaveTextContent(/Ghana only/)
  })

  it('"Choose another" returns to the manual choice; Kumasi/Ashanti is delivered door to door', () => {
    setup()
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'Ashanti' } })
    fireEvent.click(screen.getByRole('button', { name: 'Deliver here' }))
    expect(screen.getByText('Ashanti')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Deliver to/ }))
    expect(screen.getByTestId('deliver-note')).toHaveTextContent(/door-to-door in Ashanti Region/)
  })

  it('says so when the location cannot be found, and does not invent a place', async () => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (_ok, fail) => fail({ code: 1 }) } })
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Use my current location' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Couldn’t find where you are/))
    expect(localStorage.getItem('ashantihub.deliverTo')).toBeNull()
  })

  it('a customer with a saved address sees it until they choose a place; Escape closes the panel', () => {
    sessionStorage.setItem('ashantihub.deliverToAsked', '1')
    setup({ firstName: 'Ama', savedAddress: 'Asokwa, Kumasi' })
    expect(screen.getByText('Deliver to Ama')).toBeInTheDocument()
    expect(screen.getByText('Asokwa, Kumasi')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Deliver to Ama/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
