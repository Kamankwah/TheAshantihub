import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import DataExportsLogPanel from '../DataExportsLogPanel.jsx'

const downloads = vi.hoisted(() => vi.fn())
vi.mock('../../../../apiClient.js', async (importOriginal) => ({ ...(await importOriginal()), apiDownload: downloads }))

const API = 'http://localhost:8000'
const row = (id, over = {}) => ({ id, at: '2026-10-12T10:00:00Z', who: 'Ama Boateng', role: 'operations', scheduled: false, what: 'Exported businesses (12 rows)', filters: { zone: 'Manhyia' }, format: 'csv', rows: 12, personal_data: false, link_state: 'direct', link: 'Downloaded straight away, no link', ...over })
const payload = () => ({
  count: 3, page: 1, has_next: false,
  summary: { last_30_days: 3, personal_30_days: 1, scheduled_30_days: 1, not_recorded_30_days: 1 },
  people: [{ actor_id: 2, actor_label: 'Ama Boateng' }],
  results: [
    row(1),
    row(2, { who: 'System', role: '', scheduled: true, what: 'Scheduled export sent: Weekly', filters: {}, format: 'xlsx', rows: 9, personal_data: true, link: 'Link sent to Kofi' }),
    row(3, { what: 'Export', filters: {}, format: '', rows: null, personal_data: null }),
  ],
})
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

describe('DataExportsLogPanel', () => {
  beforeEach(() => downloads.mockReset().mockResolvedValue(null))

  it('lists every export with its filters, the personal-data flag and link state; unknowns say so', async () => {
    server.use(http.get(`${API}/api/staff-security/exports/`, () => HttpResponse.json(payload())))
    wrap(<DataExportsLogPanel />)
    const first = (await screen.findByText('Exported businesses (12 rows)')).closest('tr')
    expect(first).toHaveTextContent('zone: Manhyia')
    expect(first).toHaveTextContent('No')
    const scheduled = screen.getByText('Scheduled export sent: Weekly').closest('tr')
    expect(scheduled).toHaveTextContent('Scheduled')
    expect(scheduled).toHaveTextContent('Yes')
    expect(scheduled).toHaveTextContent('Link sent to Kofi')
    const old = screen.getByText('Export').closest('tr')
    expect(old.textContent.match(/Not recorded/g).length).toBe(3)
    expect(screen.getByText(/Whether a link was opened is not tracked/)).toBeInTheDocument()
  })

  it('filters on the server and offers no way to remove a line', async () => {
    const seen = []
    server.use(http.get(`${API}/api/staff-security/exports/`, ({ request }) => { seen.push(Object.fromEntries(new URL(request.url).searchParams)); return HttpResponse.json(payload()) }))
    wrap(<DataExportsLogPanel />)
    await screen.findByText('Exported businesses (12 rows)')
    fireEvent.change(screen.getByLabelText('Personal data'), { target: { value: 'yes' } })
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ personal: 'yes' }))
    expect(screen.queryByRole('button', { name: /delete|remove/i })).not.toBeInTheDocument()
  })

  it('exports the list through the audit export, which asks for the password', async () => {
    server.use(http.get(`${API}/api/staff-security/exports/`, () => HttpResponse.json(payload())))
    wrap(<DataExportsLogPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Export this list' }))
    await waitFor(() => expect(downloads).toHaveBeenCalled())
    expect(downloads.mock.calls[0][0]).toContain('/api/activity/export/?verb=report.exported')
  })
})
