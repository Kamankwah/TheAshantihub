import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import ScheduledPanel from '../ScheduledPanel.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

describe('Scheduled tab', () => {
  it("lists orders with the vendor's next opening and a Send now button", async () => {
    const opens = new Date(Date.now() + 5 * 3600e3).toISOString()
    server.use(http.get(`${API}/api/delivery/scheduled/`, () => HttpResponse.json({
      count: 1, next: null, previous: null,
      results: [{ order_id: 41, placed_at: new Date().toISOString(), ready_not_before: opens, customer_name: 'Ama', delivery_address: '12 Ash Rd',
        vendors: [{ business_id: 3, business_name: 'Akosua Ntoma', next_open: opens }, { business_id: 4, business_name: 'Kofi Foods', next_open: null }] }],
    })))
    wrap(<ScheduledPanel />)
    expect(await screen.findByText('#41')).toBeInTheDocument()
    expect(screen.getByText(/Akosua Ntoma:/)).toBeInTheDocument()
    expect(screen.getAllByText(/^opens /)).toHaveLength(1)
    expect(screen.getByText('no opening time to show')).toBeInTheDocument()
    expect(screen.getByText(/Kofi Foods:/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send now' })).toBeInTheDocument()
  })
})
