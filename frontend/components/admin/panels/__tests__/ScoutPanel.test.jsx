import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ScoutPanel from '../ScoutPanel.jsx'

const API = 'http://localhost:8000'
const ASSIGNMENT = {
  id: 3, business_owner: 7, business_owner_name: 'Kofi Ampofo Bekoe', business_login_phone: '+233244000118',
  gps_address: 'AK-039-5028', status: 'assigned',
}

function open() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><ScoutPanel /></QueryClientProvider>)
}

describe('ScoutPanel — submitting a report', () => {
  const submit = async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: /Submit report/ }))
    fireEvent.click(screen.getAllByRole('button', { name: '✓ Yes' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Submit field report' }))
  }

  it("shows the server's reason when the report is refused", async () => {
    server.use(
      http.get(`${API}/api/accounts/scout-assignments/mine/`, () => HttpResponse.json([ASSIGNMENT])),
      http.post(`${API}/api/accounts/scout-assignments/3/verify/`, () => HttpResponse.json({ detail: "You supplied or changed this business's details, so someone else decides its KYC." }, { status: 403 })),
    )
    await submit()
    expect(await screen.findByText("You supplied or changed this business's details, so someone else decides its KYC.")).toBeInTheDocument()
  })

  it('keeps the connection message when there is no server reason', async () => {
    server.use(
      http.get(`${API}/api/accounts/scout-assignments/mine/`, () => HttpResponse.json([ASSIGNMENT])),
      http.post(`${API}/api/accounts/scout-assignments/3/verify/`, () => HttpResponse.error()),
    )
    await submit()
    expect(await screen.findByText('Could not submit the report. Check your connection and try again.')).toBeInTheDocument()
  })
})
