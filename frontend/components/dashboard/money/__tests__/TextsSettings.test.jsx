import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import TextsSettings from '../TextsSettings.jsx'

const API = 'http://localhost:8000'
const URL_ = `${API}/api/wallet/vendor/texts/`
const NOTE = 'Money texts go only to a Ghana mobile number you have confirmed with a code. Yours is not confirmed, so your money notices stay in the app.'
const wrap = (ui) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}
const text = (over = {}) => ({
  id: 1, kind: 'order_paid', order: 5, day: null, body: 'GHS 50.00 paid for order 5.', status: 'sent',
  status_label: 'Sent', to: '024 *** 4567', created_at: '2026-10-20T09:05:00Z', simulated: false,
  sent_at: '2026-10-20T09:06:00Z', ...over,
})
const serve = (over = {}) => server.use(http.get(URL_, () => HttpResponse.json({
  order_texts: true, daily_digest: false, phone: '024 *** 4567', note: null, recent: [], ...over,
})))
const box = () => screen.findByRole('checkbox', { name: 'Send me a daily summary text of the day before' })

describe('TextsSettings', () => {
  it('test_shows_the_masked_number_when_confirmed', async () => {
    serve()
    wrap(<TextsSettings />)
    expect(await screen.findByText('Texts go to 024 *** 4567.')).toBeInTheDocument()
    expect(screen.getByText('Texts for every paid sale and every release (orders, services, stays and tickets) always go to your number.')).toBeInTheDocument()
    expect(screen.getByText("Texts also go when a refund, a withdrawal or a low or below-zero balance touches your money, and when a booking's payment is put on hold.")).toBeInTheDocument()
  })

  it('test_shows_the_servers_note_when_no_confirmed_number', async () => {
    serve({ phone: null, note: NOTE })
    wrap(<TextsSettings />)
    expect(await screen.findByText(NOTE)).toBeInTheDocument()
    expect(screen.queryByText(/Texts go to/)).toBeNull()
    expect(document.querySelector('a[href^="tel:"], a[href*="wa.me"]')).toBeNull()
  })

  it('test_digest_checkbox_reflects_the_server', async () => {
    serve({ daily_digest: true })
    wrap(<TextsSettings />)
    expect(await box()).toBeChecked()
  })

  it('test_review_focus_toggle_posts_once_per_click_and_shows_the_servers_answer', async () => {
    serve({ daily_digest: false })
    const posts = []
    server.use(http.patch(URL_, async ({ request }) => {
      posts.push(await request.json())
      return HttpResponse.json({ order_texts: true, daily_digest: false, phone: '024 *** 4567', note: null, recent: [] })
    }))
    wrap(<TextsSettings />)
    const cb = await box()
    fireEvent.click(cb)
    fireEvent.click(cb)
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({ daily_digest: true })
    await waitFor(() => expect(cb).not.toBeDisabled())
    expect(cb).not.toBeChecked()
    expect(posts).toHaveLength(1)
  })

  it('test_patch_error_shows_the_message_and_keeps_the_old_state', async () => {
    serve({ daily_digest: true })
    server.use(http.patch(URL_, () => HttpResponse.json({ daily_digest: 'Choose true or false.' }, { status: 400 })))
    wrap(<TextsSettings />)
    const cb = await box()
    fireEvent.click(cb)
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose true or false.')
    expect(cb).toBeChecked()
  })

  it('test_recent_texts_show_kind_word_status_label_and_body', async () => {
    serve({ recent: [text({ id: 2, kind: 'refund', body: 'Refund of GHS 10.00.' }), text()] })
    wrap(<TextsSettings />)
    expect(await screen.findByText('Order paid')).toBeInTheDocument()
    expect(screen.getByText('Refund')).toBeInTheDocument()
    expect(screen.getByText('GHS 50.00 paid for order 5.')).toBeInTheDocument()
    expect(screen.getAllByText('Sent').length).toBe(2)
    expect(screen.getAllByText(/024 \*\*\* 4567/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Tue 20 Oct, 09:05').length).toBe(2)
    expect(screen.getAllByText('Sent Tue 20 Oct, 09:06').length).toBe(2)
  })

  it('test_booking_texts_read_in_words', async () => {
    serve({ recent: [text({ id: 1, kind: 'booking_paid' }), text({ id: 2, kind: 'booking_released' }), text({ id: 3, kind: 'booking_on_hold' })] })
    wrap(<TextsSettings />)
    expect(await screen.findByText('Booking paid')).toBeInTheDocument()
    expect(screen.getByText('Booking released')).toBeInTheDocument()
    expect(screen.getByText('Booking on hold')).toBeInTheDocument()
  })

  it('test_simulated_text_shows_not_sent_and_no_sent_time', async () => {
    serve({ recent: [text({ status_label: 'Not sent: texts are simulated', simulated: true, sent_at: null })] })
    wrap(<TextsSettings />)
    expect(await screen.findByText('Not sent: texts are simulated')).toBeInTheDocument()
    expect(screen.queryByText(/^Sent /)).toBeNull()
  })

  it('test_unknown_kind_reads_money_text', async () => {
    serve({ recent: [text({ kind: 'mystery' })] })
    wrap(<TextsSettings />)
    expect(await screen.findByText('Money text')).toBeInTheDocument()
  })

  it('test_no_texts_yet', async () => {
    serve()
    wrap(<TextsSettings />)
    expect(await screen.findByText('No texts yet.')).toBeInTheDocument()
  })

  it('test_ledger_off_state', async () => {
    server.use(http.get(URL_, () => HttpResponse.json({ code: 'ledger_off' }, { status: 409 })))
    wrap(<TextsSettings />)
    expect(await screen.findByText("Wallets aren't switched on yet.")).toBeInTheDocument()
  })
})
