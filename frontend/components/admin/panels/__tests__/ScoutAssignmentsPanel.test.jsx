import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ScoutAssignmentsPanel from '../ScoutAssignmentsPanel.jsx'

// GET /api/accounts/scout-assignments/ is NOT paginated on the backend
// (ScoutAssignmentListCreateView has no pagination_class and the project sets no
// default): it returns a plain array. The panel once read `data?.results` and so
// always said "No assignments yet".
const ASSIGNMENT = {
  id: 3, business_owner: 7, business_owner_name: 'Kofi Ampofo Bekoe',
  scout: 4, scout_name: 'Yaw Boakye', status: 'assigned', visited_at: null, address_confirmed: null,
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}><ScoutAssignmentsPanel /></QueryClientProvider>,
  )
}

describe('ScoutAssignmentsPanel', () => {
  it('lists assignments from the backend plain-array response', async () => {
    server.use(http.get('http://localhost:8000/api/accounts/scout-assignments/', () => HttpResponse.json([ASSIGNMENT])))
    renderPanel()
    expect(await screen.findByText('Kofi Ampofo Bekoe')).toBeInTheDocument()
    expect(screen.queryByText('No assignments yet.')).not.toBeInTheDocument()
  })

  it('shows the empty state for an empty array', async () => {
    server.use(http.get('http://localhost:8000/api/accounts/scout-assignments/', () => HttpResponse.json([])))
    renderPanel()
    expect(await screen.findByText('No assignments yet.')).toBeInTheDocument()
  })
})
