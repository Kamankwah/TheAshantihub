import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('lets a lead switch to the team\'s calls and shows the day strip', async () => {
    const urls = []
    server.use(http.get('http://localhost:8000/api/calls/', ({ request }) => {
      urls.push(request.url)
      const team = request.url.includes('scope=team')
      return HttpResponse.json({
        count: 1, next: null, previous: null,
        results: [{ id: team ? 2 : 1, staff_name: team ? 'Yaw Owusu' : 'Ama Boateng', direction: 'out', counterpart_name: 'Adwoa Fabrics', counterpart_phone: '', purpose: 'other', outcome: 'connected', notes: '', started_at: '2026-10-07T09:00:00Z' }],
        summary: { logged: 1, connected: 1 },
        strip: { mine: 5, out: 4, in: 1, connected: 3, no_answer: 2, follow_ups: 2, team: 38 },
      })
    }))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><CallLogPanel auth={{ user: { role: 'operations' }, hasPermission: (c) => c === 'calls.view_team' }} /></QueryClientProvider>)
    expect(await screen.findByText(/by Ama Boateng/)).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Team calls today' })).getByText('38')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'My calls today' })).getByText('4 out · 1 in')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: "My team's" }))
    expect(await screen.findByText(/by Yaw Owusu/)).toBeInTheDocument()
    expect(urls.some((u) => u.includes('scope=team'))).toBe(true)
  })

  it('has no team switch without calls.view_team', async () => {
    renderPanel()
    await screen.findByText('No calls logged yet.')
    expect(screen.queryByRole('button', { name: "My team's" })).not.toBeInTheDocument()
  })
})
