import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import StatementDownload from '../StatementDownload.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}
const button = () => screen.getByRole('button', { name: /Download statement/ })
let seen
const serve = (respond) => server.use(http.get(`${API}/api/wallet/vendor/statement/export/`, ({ request }) => {
  seen.push({ url: new URL(request.url), accept: request.headers.get('accept') })
  return respond ? respond() : new HttpResponse('a,b', { headers: { 'Content-Type': 'text/csv' } })
}))

beforeEach(() => {
  seen = []
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:x')
  globalThis.URL.revokeObjectURL = vi.fn()
})

describe('StatementDownload', () => {
  it('test_download_sends_the_dates_and_names_the_file', async () => {
    serve()
    const names = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { names.push(this.download) })
    wrap(<StatementDownload />)
    expect(screen.getByText('Your sales, bookings and withdrawals with the platform fee shown separately, as a CSV.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('From (optional)'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('To (optional)'), { target: { value: '2026-10-20' } })
    fireEvent.click(button())
    await waitFor(() => expect(names).toEqual(['ashantihub-statement-2026-10-01-to-2026-10-20.csv']))
    expect(seen[0].url.searchParams.get('date_from')).toBe('2026-10-01')
    expect(seen[0].url.searchParams.get('date_to')).toBe('2026-10-20')
    click.mockRestore()
  })

  it('test_blank_dates_download_without_params', async () => {
    serve()
    const names = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { names.push(this.download) })
    wrap(<StatementDownload />)
    fireEvent.click(button())
    await waitFor(() => expect(names).toEqual(['ashantihub-statement.csv']))
    expect(seen[0].url.search).toBe('')
    click.mockRestore()
  })

  it('test_double_click_downloads_once', async () => {
    serve()
    wrap(<StatementDownload />)
    fireEvent.click(button())
    fireEvent.click(button())
    await waitFor(() => expect(globalThis.URL.createObjectURL).toHaveBeenCalled())
    expect(seen).toHaveLength(1)
    await waitFor(() => expect(button()).not.toBeDisabled())
  })

  it('test_statement_400_shows_the_servers_message', async () => {
    serve(() => HttpResponse.json({ date_from: 'Choose at most 92 days.' }, { status: 400 }))
    wrap(<StatementDownload />)
    fireEvent.click(button())
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose at most 92 days.')
    expect(button()).not.toBeDisabled()
  })

  it('test_statement_429_shows_the_servers_message', async () => {
    serve(() => HttpResponse.json({ detail: 'Too many requests. Try again in 60 seconds.' }, { status: 429 }))
    wrap(<StatementDownload />)
    fireEvent.click(button())
    expect(await screen.findByRole('alert')).toHaveTextContent(/Too many requests|try again|moment/i)
  })

  it('test_no_text_csv_accept_header_is_sent', async () => {
    serve()
    wrap(<StatementDownload />)
    fireEvent.click(button())
    await waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0].accept || '').not.toContain('text/csv')
  })
})
