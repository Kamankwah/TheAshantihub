import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SiteSettingsPanel from '../SiteSettingsPanel.jsx'

const API = 'http://localhost:8000'
function renderPanel(showToast = () => {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><SiteSettingsPanel showToast={showToast} /></QueryClientProvider>)
}

describe('SiteSettingsPanel', () => {
  it('shows the three groups and "No changes recorded yet." when nothing was recorded', async () => {
    server.use(http.get(`${API}/api/core/site-settings/history/`, () => HttpResponse.json([])))
    renderPanel()
    expect(await screen.findByRole('heading', { name: 'Footer contact details' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Social links' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Policies' })).toBeInTheDocument()
    expect(await screen.findByText('No changes recorded yet.')).toBeInTheDocument()
    expect(screen.queryByText(/unsaved/)).not.toBeInTheDocument()
  })

  it('lists only recorded changes, with before and after', async () => {
    server.use(http.get(`${API}/api/core/site-settings/history/`, () => HttpResponse.json([
      { id: 1, at: '2026-09-29T09:00:00Z', who: 'Kojo Badu', changes: [{ field: 'support_hours', label: 'Support hours', before: '7:00pm', after: '8:00pm' }] },
      { id: 2, at: '2026-09-01T09:00:00Z', who: 'Simon Peter', changes: [{ field: 'service_dispute_policy', label: 'Service satisfaction & dispute policy', before: 'a', after: 'b' }] },
    ])))
    renderPanel()
    expect(await screen.findByText('Support hours: 7:00pm → 8:00pm')).toBeInTheDocument()
    expect(screen.getByText(/Kojo Badu/)).toBeInTheDocument()
    expect(screen.getByText('Updated the service satisfaction & dispute policy')).toBeInTheDocument()
  })

  it('counts unsaved changes, discards them, and saves only the changed fields', async () => {
    const seen = {}
    const toast = vi.fn()
    server.use(
      http.get(`${API}/api/core/site-settings/history/`, () => HttpResponse.json([])),
      http.patch(`${API}/api/core/site-settings/`, async ({ request }) => { seen.patch = await request.json(); return HttpResponse.json({ ...seen.patch }) }),
    )
    renderPanel(toast)
    const hours = await screen.findByLabelText('Support hours')
    fireEvent.change(hours, { target: { value: 'Mon–Sat, 8:00am – 7:00pm GMT' } })
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument()
    expect(screen.getByText('Changed — not saved yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.queryByText(/unsaved/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Support hours')).toHaveValue('Mon–Sat, 8:00am – 8:00pm GMT')

    fireEvent.change(screen.getByLabelText('Support hours'), { target: { value: 'Mon–Fri' } })
    fireEvent.change(screen.getByLabelText('Contact address'), { target: { value: 'Adum, Kumasi' } })
    expect(screen.getByText('2 unsaved changes')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])
    await waitFor(() => expect(seen.patch).toEqual({ contact_address: 'Adum, Kumasi', support_hours: 'Mon–Fri' }))
    await waitFor(() => expect(toast).toHaveBeenCalled())
  })
})
