import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ZonesPanel from '../ZonesPanel.jsx'

const API = 'http://localhost:8000'
const SUMMARY = {
  zones: [
    { id: 1, name: 'Adum', listings: 64, businesses: 11, scouts: ['Efua Mensah'] },
    { id: 2, name: 'Kronum', listings: 0, businesses: 0, scouts: [] },
  ],
  changes: [{ id: 9, what: 'Added Kronum', who: 'Kojo Badu', at: '2026-10-02T09:00:00Z', mine: false }],
}
function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><ZonesPanel /></QueryClientProvider>)
}

describe('ZonesPanel', () => {
  it('lists zones with real counts, Scouts working it, and only offers Delete on unused zones', async () => {
    server.use(http.get(`${API}/api/listings/zones/summary/`, () => HttpResponse.json(SUMMARY)))
    renderPanel()
    expect(await screen.findByRole('heading', { name: '2 zones A–Z' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Scouts working it' })).toBeInTheDocument()
    const adum = screen.getByRole('row', { name: /Adum/ })
    expect(adum).toHaveTextContent('64')
    expect(adum).toHaveTextContent('Efua Mensah')
    expect(screen.getByRole('row', { name: /Kronum/ })).toHaveTextContent('No scout yet')
    expect(screen.queryByRole('button', { name: 'Delete Adum' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Kronum' })).toBeInTheDocument()
    expect(screen.getByText('Added Kronum')).toBeInTheDocument()
    expect(screen.queryByText(/categor/i)).not.toBeInTheDocument()
  })

  it('says when nothing has been recorded', async () => {
    server.use(http.get(`${API}/api/listings/zones/summary/`, () => HttpResponse.json({ zones: [], changes: [] })))
    renderPanel()
    expect(await screen.findByText('No changes recorded yet.')).toBeInTheDocument()
  })

  it('renames, deletes and adds through the zone endpoints', async () => {
    const seen = {}
    server.use(
      http.get(`${API}/api/listings/zones/summary/`, () => HttpResponse.json(SUMMARY)),
      http.patch(`${API}/api/listings/zones/:id/`, async ({ request }) => { seen.patch = await request.json(); return HttpResponse.json({ id: 1, name: 'Adum Central' }) }),
      http.delete(`${API}/api/listings/zones/:id/`, () => { seen.deleted = true; return new HttpResponse(null, { status: 204 }) }),
      http.post(`${API}/api/listings/zones/`, async ({ request }) => { seen.post = await request.json(); return HttpResponse.json({ id: 3, name: 'Tafo' }, { status: 201 }) }),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Adum' }))
    fireEvent.change(screen.getByLabelText('New name for Adum'), { target: { value: 'Adum Central' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(seen.patch).toEqual({ name: 'Adum Central' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Kronum' }))
    fireEvent.click(within(screen.getByRole('row', { name: /Kronum/ })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(seen.deleted).toBe(true))
    fireEvent.change(screen.getByLabelText('Zone name'), { target: { value: 'Tafo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add zone' }))
    await waitFor(() => expect(seen.post).toEqual({ name: 'Tafo' }))
  })

  it('shows the server reason when a delete is refused', async () => {
    server.use(
      http.get(`${API}/api/listings/zones/summary/`, () => HttpResponse.json(SUMMARY)),
      http.delete(`${API}/api/listings/zones/:id/`, () => HttpResponse.json({ detail: 'Kronum is still used by 1 business. Rename it instead.' }, { status: 409 })),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Kronum' }))
    fireEvent.click(within(screen.getByRole('row', { name: /Kronum/ })).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Rename it instead.')
  })
})
