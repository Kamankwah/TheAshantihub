import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import RecoveryRequestForm from '../RecoveryRequestForm.jsx'
import SupportPeoplePanel from '../SupportPeoplePanel.jsx'

const URL = 'http://localhost:8000/api/otp/recovery/'
const REASON = 'How you confirmed it is really them'

describe('RecoveryRequestForm', () => {
  it('hidden without otp.recovery', async () => {
    server.use(
      http.post('http://localhost:8000/api/support/staff/profile-opened/', () => HttpResponse.json({})),
      http.get('http://localhost:8000/api/support/staff/people/recent/', () => HttpResponse.json({ results: [] })),
      http.get('http://localhost:8000/api/support/staff/customers/7/360/', () => HttpResponse.json({
      kind: 'customer', profile: { id: 7, name: 'Ama Boateng', since: '2026-01-01T00:00:00Z', status: { key: 'active', label: 'Active' } },
      kpis: {}, orders: [], conversations: [], calls: [], disputes: [], reviews: [],
      })),
    )
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = (canRecover) => (
      <QueryClientProvider client={qc}><SupportPeoplePanel profile={{ kind: 'customer', id: 7 }} canRecover={canRecover} onBack={() => {}} /></QueryClientProvider>
    )
    const { unmount } = render(view(false))
    await screen.findByText('Ama Boateng')
    expect(screen.queryByText(REASON)).not.toBeInTheDocument()
    unmount()
    render(view(true))
    expect(await screen.findByLabelText(REASON)).toBeInTheDocument()
  })

  it('requires a reason', () => {
    let sent = false
    server.use(http.post(URL, () => { sent = true; return HttpResponse.json({}, { status: 201 }) }))
    render(<RecoveryRequestForm kind="customer" id={7} name="Ama" />)
    fireEvent.change(screen.getByLabelText(REASON), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/Say how you confirmed/)
    expect(sent).toBe(false)
  })

  it('posts account_type business_owner for a business profile', async () => {
    let body = null
    server.use(http.post(URL, async ({ request }) => { body = await request.json(); return HttpResponse.json({ approval_id: 12, status: 'pending' }, { status: 201 }) }))
    render(<RecoveryRequestForm kind="business" id={31} name="Akosua Ntoma" />)
    fireEvent.change(screen.getByLabelText('Send the reset link by'), { target: { value: 'email' } })
    fireEvent.change(screen.getByLabelText(REASON), { target: { value: '  Called back on the number we hold.  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }))
    await waitFor(() => expect(body).toEqual({ account_type: 'business_owner', account_id: 31, send_to: 'email', reason: 'Called back on the number we hold.' }))
  })

  it('shows the approval id on 201', async () => {
    server.use(http.post(URL, () => HttpResponse.json({ approval_id: 12, status: 'pending' }, { status: 201 })))
    render(<RecoveryRequestForm kind="customer" id={7} name="Ama" />)
    fireEvent.change(screen.getByLabelText(REASON), { target: { value: 'Verified' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Sent for approval (A-12). A Super Admin decides it; the person is told by text once it is approved.')
  })

  it('does not claim a wait when the request was applied at once', async () => {
    server.use(http.post(URL, () => HttpResponse.json({ approval_id: 13, status: 'approved' }, { status: 201 })))
    render(<RecoveryRequestForm kind="customer" id={7} name="Ama" />)
    fireEvent.change(screen.getByLabelText(REASON), { target: { value: 'Verified' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }))
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Done (A-13)')
    expect(status).not.toHaveTextContent('decides it')
  })

  it('shows the server refusal text', async () => {
    server.use(http.post(URL, () => HttpResponse.json({ detail: 'This account is suspended, so its sign-in can\'t be recovered.' }, { status: 400 })))
    render(<RecoveryRequestForm kind="customer" id={7} name="Ama" />)
    fireEvent.change(screen.getByLabelText(REASON), { target: { value: 'Verified' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("This account is suspended, so its sign-in can't be recovered.")
  })

  it('never renders a phone or email', () => {
    const { container } = render(<RecoveryRequestForm kind="customer" id={7} name="Ama" />)
    expect(container.textContent).not.toMatch(/@|\+?\d{9,}/)
    expect(screen.getByRole('option', { name: 'Text' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Email' })).toBeInTheDocument()
  })
})
