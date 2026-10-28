import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    wrap(<ScheduledPanel auth={{ hasPermission: (c) => c === 'delivery.manage' }} />)
    expect(await screen.findByText('#41')).toBeInTheDocument()
    expect(screen.getByText(/Akosua Ntoma:/)).toBeInTheDocument()
    expect(screen.getAllByText(/^opens /)).toHaveLength(1)
    expect(screen.getByText('no opening time to show')).toBeInTheDocument()
    expect(screen.getByText(/Kofi Foods:/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send now' })).toBeInTheDocument()
  })
})

describe('Scheduled tab Send now permission', () => {
  const held = (id) => {
    const opens = new Date(Date.now() + 5 * 3600e3).toISOString()
    server.use(http.get(`${API}/api/delivery/scheduled/`, () => HttpResponse.json({
      count: 1, next: null, previous: null,
      results: [{ order_id: id, placed_at: new Date().toISOString(), ready_not_before: opens, customer_name: 'Ama', delivery_address: '', vendors: [] }],
    })))
  }

  // Director ruling 7 (2026-10-20): whoever reads the list with orders.manage_delivery may also Send now.
  it('shows Send now to a user holding only orders.manage_delivery', async () => {
    held(61)
    wrap(<ScheduledPanel auth={{ hasPermission: (c) => c === 'orders.manage_delivery' }} />)
    expect(await screen.findByText('#61')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send now' })).toBeInTheDocument()
  })

  it('send now hidden without either permission', async () => {
    held(62)
    wrap(<ScheduledPanel auth={{ hasPermission: (c) => c === 'orders.view' }} />)
    expect(await screen.findByText('#62')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send now' })).not.toBeInTheDocument()
  })
})

describe('Scheduled tab paging', () => {
  it('falls back to page 1 when the page it is on no longer exists', async () => {
    const row = { order_id: 51, placed_at: new Date().toISOString(), ready_not_before: new Date(Date.now() + 3600e3).toISOString(), customer_name: 'Yaw', delivery_address: '', vendors: [] }
    const pages = []
    server.use(http.get(`${API}/api/delivery/scheduled/`, ({ request }) => {
      const page = new URL(request.url).searchParams.get('page')
      pages.push(page)
      if (page === '2') return HttpResponse.json({ detail: 'Invalid page.' }, { status: 404 })
      return HttpResponse.json({ count: 11, next: 'x', previous: null, results: [row] })
    }))
    wrap(<ScheduledPanel auth={{ hasPermission: () => true }} />)
    await screen.findByText('#51')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(pages).toContain('2'))
    expect(await screen.findByText('#51')).toBeInTheDocument()
    expect(screen.getByText('Page 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
  })
})
