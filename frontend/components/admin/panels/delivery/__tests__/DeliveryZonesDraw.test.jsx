import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import DeliveryZonesPanel from '../DeliveryZonesPanel.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const zone = (over) => ({ id: 1, name: 'Adum', boundary: null, area_km2: null, express_offered: false, active: true, riders: [], ...over })
const TRI = [[-1.62, 6.69], [-1.6, 6.69], [-1.61, 6.71]]

const open = async (zones) => {
  let body
  server.use(
    http.get(`${API}/api/delivery/zones/`, () => HttpResponse.json({ results: zones })),
    http.patch(`${API}/api/delivery/zones/1/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}) }),
  )
  wrap(<DeliveryZonesPanel />)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit boundary' }))
  return () => body
}

describe('Zone drawing', () => {
  it('saves a drawn shape in [lng, lat] order and mirrors it into the text box', async () => {
    const getBody = await open([zone()])
    expect(screen.getByTestId('zone-draw-map')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'draw triangle' }))
    expect(screen.getByLabelText(/Boundary/).value).toBe('-1.62, 6.69\n-1.6, 6.69\n-1.61, 6.71')
    fireEvent.click(screen.getByRole('button', { name: 'Save zone' }))
    await waitFor(() => expect(getBody()).toEqual({ name: 'Adum', boundary: TRI }))
  })

  it('clearing the shape sends boundary null', async () => {
    const getBody = await open([zone({ boundary: TRI })])
    fireEvent.click(screen.getByRole('button', { name: 'clear shape' }))
    expect(screen.getByLabelText(/Boundary/).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Save zone' }))
    await waitFor(() => expect(getBody()).toEqual({ name: 'Adum', boundary: null }))
  })

  it('still saves a ring typed in the text disclosure', async () => {
    const getBody = await open([zone()])
    expect(screen.getByText('Edit coordinates as text')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Boundary/), { target: { value: '-1.62, 6.69\n-1.60, 6.69\n-1.61, 6.71' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save zone' }))
    await waitFor(() => expect(getBody()).toEqual({ name: 'Adum', boundary: TRI }))
  })
})
