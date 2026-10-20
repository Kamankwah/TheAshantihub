import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ProfilePanel from '../ProfilePanel.jsx'

const URL = 'http://localhost:8000/api/accounts/business-owners/me/detail-changes/'
const PROFILE = { ghana_card_number: 'GHA-1', gps_address: 'AK-1', business_contact_phone: '+233200000000', is_formal: false }

function renderPanel(rows = []) {
  server.use(
    http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => HttpResponse.json(PROFILE)),
    http.get(URL, () => HttpResponse.json({ results: rows })),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><ProfilePanel user={{ fullName: 'Kofi' }} /></QueryClientProvider>)
}

describe('ProfilePanel: request a change', () => {
  it('says a scout will visit and two staff approve, and shows an honest empty list', async () => {
    renderPanel()
    expect(await screen.findByText(/scout will visit your business, then two AshantiHub staff approve/)).toBeInTheDocument()
    expect(screen.getByText(/Payout destinations wait again after approval/)).toBeInTheDocument()
    expect(await screen.findByText('No change requests yet.')).toBeInTheDocument()
  })

  it('request form posts field, new_value and reason', async () => {
    let posted = null
    renderPanel()
    server.use(http.post(URL, async ({ request }) => { posted = await request.json(); return HttpResponse.json({ id: 5 }, { status: 201 }) }))
    fireEvent.change(await screen.findByLabelText('What to change'), { target: { value: 'login_phone' } })
    fireEvent.change(screen.getByLabelText('New value'), { target: { value: '0241112222' } })
    fireEvent.change(screen.getByLabelText('Why do you need this change?'), { target: { value: 'Lost my old SIM' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Your request to change the sign-in phone was sent. Nothing has changed yet.')
    expect(posted).toEqual({ field: 'login_phone', new_value: '0241112222', reason: 'Lost my old SIM' })
    expect(screen.getByLabelText('New value')).toHaveValue('')
  })

  it('shows the server refusal in its own words and does not claim success', async () => {
    renderPanel()
    server.use(http.post(URL, () => HttpResponse.json({ detail: 'A change to this detail is already in progress.', code: 'change_pending' }, { status: 409 })))
    fireEvent.change(await screen.findByLabelText('New value'), { target: { value: 'Kofi A' } })
    fireEvent.change(screen.getByLabelText('Why do you need this change?'), { target: { value: 'Spelling' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A change to this detail is already in progress.')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('explains a step-up requirement instead of failing silently', async () => {
    renderPanel()
    server.use(http.post(URL, () => HttpResponse.json({ detail: 'x', code: 'step_up_required', action: 'detail_change' }, { status: 403 })))
    fireEvent.change(await screen.findByLabelText('New value'), { target: { value: 'Kofi A' } })
    fireEvent.change(screen.getByLabelText('Why do you need this change?'), { target: { value: 'Spelling' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/sign-in code/)
  })

  it('status labels', async () => {
    const base = { field: 'email', field_label: 'Email', new_value: 'ko•••@x.com', can_withdraw: false }
    renderPanel([
      { ...base, id: 1, status: 'requested', can_withdraw: true },
      { ...base, id: 2, status: 'assigned', can_withdraw: true, assigned_scout_first_name: 'Yaw' },
      { ...base, id: 3, status: 'verified' },
      { ...base, id: 4, status: 'approved' },
      { ...base, id: 5, status: 'not_verified' },
    ])
    expect(await screen.findByText('Waiting for a visit')).toBeInTheDocument()
    expect(screen.getByText('A scout will visit (Yaw)')).toBeInTheDocument()
    expect(screen.getByText('Checked, waiting for approval')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('Not confirmed')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Withdraw' })).toHaveLength(2)
  })

  it('withdraws a waiting request', async () => {
    let withdrawn = 0
    renderPanel([{ id: 1, field: 'email', field_label: 'Email', new_value: 'ko•••@x.com', status: 'requested', can_withdraw: true }])
    server.use(http.post(`${URL}1/withdraw/`, () => { withdrawn += 1; return HttpResponse.json({ id: 1, status: 'withdrawn' }) }))
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }))
    await waitFor(() => expect(withdrawn).toBe(1))
    expect(await screen.findByText('Request withdrawn.')).toBeInTheDocument()
  })
})
