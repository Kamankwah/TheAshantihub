import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
})
