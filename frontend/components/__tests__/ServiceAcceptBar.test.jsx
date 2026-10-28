import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../mocks/server.js'
import ServiceAcceptBar from '../ServiceAcceptBar.jsx'

const API = 'http://localhost:8000'
const request = (extra = {}) => ({ id: 7, status: 'completed', auto_accept_at: '2026-10-23T14:05:00Z', settled: false, problem_reported: false, ...extra })

describe('ServiceAcceptBar', () => {
  it('shows Accept and Report buttons with the exact auto-accept time', () => {
    render(<ServiceAcceptBar request={request()} onChanged={() => {}} />)
    expect(screen.getByRole('button', { name: 'Accept service' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Report a problem' })).toBeInTheDocument()
    expect(screen.getByText(/Accepts automatically on/)).toHaveTextContent('23 Oct')
    expect(screen.getByText(/unless you report a problem/)).toBeInTheDocument()
  })

  it('hides everything after release, and when the service is not done yet', () => {
    const { container, rerender } = render(<ServiceAcceptBar request={request({ settled: true, auto_accept_at: null })} onChanged={() => {}} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<ServiceAcceptBar request={request({ status: 'in_progress', auto_accept_at: null })} onChanged={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says a reported problem is with Support instead of offering the buttons', () => {
    render(<ServiceAcceptBar request={request({ problem_reported: true })} onChanged={() => {}} />)
    expect(screen.getByText(/Support is looking into it/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accept service' })).toBeNull()
  })

  it('accepts and tells the page to refresh', async () => {
    const onChanged = vi.fn()
    let called = false
    server.use(http.post(`${API}/api/services/requests/7/accept/`, () => { called = true; return HttpResponse.json({ released: true }) }))
    render(<ServiceAcceptBar request={request()} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept service' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(called).toBe(true)
  })

  it('sends the reason when reporting a problem, and shows the server message on a refusal', async () => {
    let body = null
    server.use(http.post(`${API}/api/services/requests/7/report-problem/`, async ({ request: r }) => { body = await r.json(); return HttpResponse.json({ detail: 'This has already been settled.' }, { status: 409 }) }))
    render(<ServiceAcceptBar request={request()} onChanged={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }))
    fireEvent.change(screen.getByLabelText('What went wrong?'), { target: { value: 'Half the work was not done.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already been settled')
    expect(body).toEqual({ reason: 'Half the work was not done.' })
  })

  describe('with the money block', () => {
    const money = (extra = {}) => ({
      sale: 31, release_at: null, released_at: null, accepted_at: null, refunded: null, refunded_whole: false, problem: null,
      policy: { policy: 'none', tiers: [], text: '' }, start: null, can_cancel: true, can_report: false, ...extra,
    })
    const mount = (req, props = {}) => render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ServiceAcceptBar request={req} onChanged={() => {}} {...props} />
      </QueryClientProvider>,
    )

    it('offers Cancel service while in progress when the server allows it', () => {
      server.use(http.get(`${API}/api/ledger/bookings/31/cancel-quote/`, () => HttpResponse.json({ refund: '80.00', whole: true })))
      mount(request({ status: 'in_progress', auto_accept_at: null, money: money() }))
      fireEvent.click(screen.getByRole('button', { name: 'Cancel service' }))
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('hides Cancel when can_cancel is false', () => {
      const { container } = mount(request({ status: 'in_progress', auto_accept_at: null, money: money({ can_cancel: false }) }))
      expect(screen.queryByRole('button', { name: 'Cancel service' })).toBeNull()
      expect(container).toBeEmptyDOMElement()
    })

    it('hides Report after Support settled the problem but keeps Accept', () => {
      mount(request({ money: money({ problem: 'closed', can_cancel: false, can_report: false, release_at: '2026-10-23T14:05:00Z' }) }))
      expect(screen.getByText('Support has settled the problem you reported.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Accept service' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Report a problem' })).toBeNull()
    })

    it('still offers Accept on a completed service after a partial refund the customer did not make', () => {
      mount(request({ money: money({ can_cancel: false, can_report: true, refunded: '30.00', refunded_whole: false, cancelled_by_you: false, release_at: '2026-10-23T14:05:00Z' }) }))
      expect(screen.getByText('GH₵ 30.00 went back to your AshantiHub wallet.')).toBeInTheDocument()
      expect(screen.queryByText(/keeps the rest/)).toBeNull()
      expect(screen.getByRole('button', { name: 'Accept service' })).toBeInTheDocument()
      expect(screen.getByText(/Accepts automatically on/)).toBeInTheDocument()
    })

    it('states a customer partial cancel as settled with no Accept', () => {
      mount(request({ money: money({ can_cancel: false, can_report: false, refunded: '30.00', refunded_whole: false, cancelled_by_you: true, release_at: '2026-10-23T14:05:00Z' }) }))
      expect(screen.getByText('The business keeps the rest under the cancellation policy.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Accept service' })).toBeNull()
    })

    it('drops the report clause from the auto-accept time once Report is not offered', () => {
      mount(request({ money: money({ problem: 'closed', can_cancel: false, can_report: false, release_at: '2026-10-23T14:05:00Z' }) }))
      expect(screen.getByText(/Accepts automatically on/)).not.toHaveTextContent(/unless you report/)
    })

    it('says the customer accepted it once released by accept', () => {
      const onContactSupport = vi.fn()
      mount(request({ settled: true, listing_name: 'Kofi Plumbing', money: money({ can_cancel: false, released_at: '2026-10-22T10:00:00Z', accepted_at: '2026-10-22T10:00:00Z' }) }), { onContactSupport })
      expect(screen.getByText(/You accepted this on Thu 22 Oct, 10:00\. The business has been paid\./)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Contact AshantiHub Support' }))
      expect(onContactSupport).toHaveBeenCalledWith({ name: 'Kofi Plumbing' })
    })

    it('says the business was paid on the timer', () => {
      mount(request({ settled: true, money: money({ can_cancel: false, released_at: '2026-10-23T14:05:00Z' }) }))
      expect(screen.getByText(/The business was paid on Fri 23 Oct, 14:05\./)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Contact AshantiHub Support' })).toBeNull()
    })
    it('shows the server state again once the refetched request differs from the cancel confirmation', async () => {
      server.use(
        http.get(`${API}/api/ledger/bookings/31/cancel-quote/`, () => HttpResponse.json({ refund: '80.00', whole: true })),
        http.post(`${API}/api/services/requests/7/cancel/`, () => HttpResponse.json({ cancelled: true, wallet_refund: '80.00' })),
      )
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const ui = (req) => <QueryClientProvider client={client}><ServiceAcceptBar request={req} onChanged={() => {}} /></QueryClientProvider>
      const before = request({ status: 'in_progress', auto_accept_at: null, money: money() })
      const { rerender } = render(ui(before))
      fireEvent.click(screen.getByRole('button', { name: 'Cancel service' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel service' }))
      expect(await screen.findByText(/^Cancelled\./)).toBeInTheDocument()
      rerender(ui(request({ status: 'cancelled', auto_accept_at: null, money: money({ can_cancel: false, refunded: '80.00', refunded_whole: true }) })))
      expect(screen.getByText('Refunded in full: GH₵ 80.00 went back to your AshantiHub wallet.')).toBeInTheDocument()
      expect(screen.queryByText(/^Cancelled\./)).toBeNull()
    })
  })
})
