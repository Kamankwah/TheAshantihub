import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import DispatchQueuePanel from '../DispatchQueuePanel.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const auth = { user: { full_name: 'Adwoa Sarpong', role: 'delivery_manager' }, hasPermission: () => true }
const queueData = (over = {}) => ({ results: [], total: 0, auto_assign: { on: true, rules: {}, updated_at: null }, recent: [], deadlines: 'none', routing: { factor: 1.3 }, ...over })
const row = { order_id: 7, waiting_minutes: 12, route: { from: 'Kente House', to: 'Ahodwo' }, zone: 'Adum', unzoned: false, returned: true, payment: { label: 'Paid online (simulated)' }, deadline_at: null, minutes_to_spare: 40, offer: null, held_until: null, refusals: 0, suggested: { rider_id: 1, full_name: 'Kofi Appiah', total: 71.5, km: 1.2 }, eligible: 1, pickup_located: true }
const ranking = { pickup_located: true, eligible: [{ rider_id: 1, full_name: 'Kofi Appiah', km: 1.2, total: 71.5, vehicle_type: 'motorbike', active_jobs: 0, parts: [] }], left_out: [] }
const serve = (r) => server.use(http.get(`${API}/api/delivery/queue/`, () => HttpResponse.json(queueData({ results: [r], total: 1 }))))

describe('dispatch queue holds', () => {
  it("a returned order says AshantiHub's own riders first", async () => {
    serve({ ...row, assign_limit: { code: 'in_house_first', label: "Re-assigned: AshantiHub's own riders first" } })
    wrap(<DispatchQueuePanel auth={auth} onNavigate={() => {}} />)
    expect(await screen.findByText("Re-assigned: AshantiHub's own riders first")).toBeInTheDocument()
  })

  it('an unpaid re-delivery says it waits for the customer', async () => {
    serve({ ...row, assign_limit: { code: 'redelivery_fee_unpaid', label: 'Waiting for the customer to pay the re-delivery fee' } })
    wrap(<DispatchQueuePanel auth={auth} onNavigate={() => {}} />)
    expect(await screen.findByText('Waiting for the customer to pay the re-delivery fee')).toBeInTheDocument()
  })

  it('an offer refused with redelivery_in_house_only shows the server text', async () => {
    const detail = "A re-delivery is done by AshantiHub's own riders while one is available."
    server.use(
      http.get(`${API}/api/delivery/queue/`, () => HttpResponse.json(queueData({ results: [{ ...row, assign_limit: { code: 'redelivery_in_house_first', label: "Re-delivery: AshantiHub's own riders first" } }], total: 1 }))),
      http.get(`${API}/api/delivery/queue/7/ranking/`, () => HttpResponse.json(ranking)),
      http.post(`${API}/api/delivery/queue/7/offer/`, () => HttpResponse.json({ code: 'redelivery_in_house_only', detail }, { status: 409 })),
    )
    wrap(<DispatchQueuePanel auth={auth} onNavigate={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Choose rider' }))
    const region = await screen.findByRole('region', { name: 'Order #7 detail' })
    fireEvent.click(await within(region).findByRole('button', { name: 'Offer to Kofi Appiah' }))
    expect(await within(region).findByText(detail)).toBeInTheDocument()
  })

  it('no chip without assign_limit', async () => {
    serve({ ...row, returned: false })
    wrap(<DispatchQueuePanel auth={auth} onNavigate={() => {}} />)
    await screen.findByText('#7')
    expect(screen.queryByText(/own riders first/)).toBeNull()
    expect(screen.queryByText(/re-delivery fee/)).toBeNull()
  })
})
