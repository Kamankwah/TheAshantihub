import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import CallLogPanel from '../CallLogPanel.jsx'

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><CallLogPanel /></QueryClientProvider>)
}

describe('CallLogPanel', () => {
  it('logs a call with a follow-up', async () => {
    let body = null
    server.use(
      http.get('http://localhost:8000/api/calls/purposes/', () => HttpResponse.json([{ value: 'subscription_payment', label: 'Subscription payment' }, { value: 'other', label: 'Other' }])),
      http.post('http://localhost:8000/api/calls/', async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 1 }, { status: 201 }) }),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Log a call' }))
    fireEvent.change(screen.getByLabelText('Who'), { target: { value: 'Adwoa Fabrics' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '0244123118' } })
    await screen.findByRole('option', { name: 'Subscription payment' })
    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'subscription_payment' } })
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'promised_to_pay' } })
    fireEvent.change(screen.getByLabelText('Follow up on'), { target: { value: '2030-01-02T09:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save call' }))
    await waitFor(() => expect(body?.purpose).toBe('subscription_payment'))
    expect(body).toMatchObject({ direction: 'out', counterpart_name: 'Adwoa Fabrics', outcome: 'promised_to_pay' })
    expect(body.follow_up_at).toMatch(/^2030-01-02T/)
  })

  it('shows the server message when a save is refused (follow-up in the future)', async () => {
    server.use(http.post('http://localhost:8000/api/calls/', () => HttpResponse.json({ follow_up_at: ['Pick a follow-up time in the future.'] }, { status: 400 })))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Log a call' }))
    fireEvent.change(screen.getByLabelText('Who'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save call' }))
    expect(await screen.findByText('Pick a follow-up time in the future.')).toBeInTheDocument()
  })

  it('refuses a past follow-up client-side without posting', async () => {
    let posted = false
    server.use(http.post('http://localhost:8000/api/calls/', () => { posted = true; return HttpResponse.json({}, { status: 201 }) }))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Log a call' }))
    fireEvent.change(screen.getByLabelText('Who'), { target: { value: 'X' } })
    fireEvent.change(screen.getByLabelText('Follow up on'), { target: { value: '2020-01-02T09:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save call' }))
    expect(await screen.findByText('Pick a follow-up time in the future.')).toBeInTheDocument()
    expect(posted).toBe(false)
  })
})
