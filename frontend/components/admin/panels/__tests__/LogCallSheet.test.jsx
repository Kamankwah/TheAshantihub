import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import LogCallSheet from '../LogCallSheet.jsx'

const API = 'http://localhost:8000'
const WHO = {
  businesses: [{ id: 12, business_name: 'Adwoa Fabrics', owner_name: 'Adwoa Frimpong', phone_masked: '024 *** 118' }],
  prospects: [{ id: 3, name: 'Ohemaa Waakye Joint', phone_masked: '024 *** 567', status: 'interested' }],
}
const PURPOSES = [
  { value: 'subscription_payment', label: 'Subscription reminder' }, { value: 'prospecting', label: 'Prospecting' }, { value: 'other', label: 'Other' },
]

function renderSheet(props = {}) {
  server.use(
    http.get(`${API}/api/calls/counterparts/`, () => HttpResponse.json(WHO)),
    http.get(`${API}/api/calls/purposes/`, () => HttpResponse.json(PURPOSES)),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(<QueryClientProvider client={queryClient}><LogCallSheet onClose={onClose} onSaved={onSaved} {...props} /></QueryClientProvider>)
  return { onClose, onSaved }
}

const tomorrow = () => {
  const d = new Date(Date.now() + 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('LogCallSheet', () => {
  it('is a modal dialog with the canvas fields and the seven outcome pills', async () => {
    renderSheet()
    const dialog = await screen.findByRole('dialog', { name: 'Log a call' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const outcomes = within(within(dialog).getByRole('group', { name: 'Outcome' })).getAllByRole('button')
    expect(outcomes.map((b) => b.textContent)).toEqual(['Connected', 'No answer', 'Busy', 'Voicemail', 'Wrong number', 'Promised to pay', 'Callback requested'])
    expect(within(within(dialog).getByRole('group', { name: 'How it went' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Good', 'Neutral', 'Poor'])
    expect(within(within(dialog).getByRole('group', { name: 'Direction' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Out', 'In'])
    expect(within(dialog).getAllByRole('option', { name: /Phone|WhatsApp|SMS|In person/ }).map((o) => o.textContent)).toEqual(['Phone', 'WhatsApp', 'SMS', 'In person'])
    expect(within(dialog).getByText('Time is stamped by the server. You can edit this call for 24 hours.')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/Started/)).not.toBeInTheDocument()
  })

  it('marks the chosen outcome pressed', async () => {
    renderSheet()
    const dialog = await screen.findByRole('dialog')
    const noAnswer = within(dialog).getByRole('button', { name: 'No answer' })
    expect(within(dialog).getByRole('button', { name: 'Connected' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(noAnswer)
    expect(noAnswer).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByRole('button', { name: 'Connected' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows the masked phone from the record, and says a follow-up creates a task', async () => {
    renderSheet()
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('option', { name: 'Adwoa Fabrics · Adwoa Frimpong (owner)' })
    fireEvent.change(within(dialog).getByLabelText('Who'), { target: { value: 'business_owner:12' } })
    expect(within(dialog).getByText('Phone 024 *** 118 · from the business record')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Who'), { target: { value: 'prospect:3' } })
    expect(within(dialog).getByText('Phone 024 *** 567 · from the prospect list')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Follow-up date'), { target: { value: tomorrow() } })
    expect(within(dialog).getByText(/^Creates a follow-up task for \w+day \d+ \w+$/)).toBeInTheDocument()
  })

  it('posts the record id, never a name, phone or start time', async () => {
    let body = null
    server.use(http.post(`${API}/api/calls/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 1 }, { status: 201 }) }))
    const { onSaved } = renderSheet()
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('option', { name: 'Ohemaa Waakye Joint (prospect)' })
    fireEvent.change(within(dialog).getByLabelText('Who'), { target: { value: 'prospect:3' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Poor' }))
    fireEvent.change(within(dialog).getByLabelText('How long (minutes, optional)'), { target: { value: '6' } })
    fireEvent.change(within(dialog).getByLabelText('Follow-up date'), { target: { value: tomorrow() } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save call' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(body).toMatchObject({
      counterpart_type: 'prospect', counterpart_id: 3, direction: 'out', channel: 'phone', purpose: 'prospecting',
      outcome: 'connected', sentiment: 'negative', duration_seconds: 360,
    })
    expect(new Date(body.follow_up_at).getTime()).toBeGreaterThan(Date.now())
    for (const key of ['started_at', 'counterpart_name', 'counterpart_phone']) expect(body).not.toHaveProperty(key)
  })

  it('asks who you spoke to before saving anything', async () => {
    let posted = false
    server.use(http.post(`${API}/api/calls/`, () => { posted = true; return HttpResponse.json({}, { status: 201 }) }))
    renderSheet()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save call' }))
    expect(await within(dialog).findByText('Choose who you spoke to.')).toBeInTheDocument()
    expect(posted).toBe(false)
  })

  it('shows the server message when a save is refused', async () => {
    server.use(http.post(`${API}/api/calls/`, () => HttpResponse.json({ counterpart_id: ["That business isn't in your portfolio."] }, { status: 400 })))
    const { onSaved } = renderSheet({ preset: { type: 'business_owner', id: 12 } })
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('option', { name: 'Adwoa Fabrics · Adwoa Frimpong (owner)' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save call' }))
    expect(await within(dialog).findByText("That business isn't in your portfolio.")).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('closes on Escape and on Close, and keeps Tab inside', async () => {
    const { onClose } = renderSheet()
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    const save = within(dialog).getByRole('button', { name: 'Save call' })
    save.focus()
    fireEvent.keyDown(save, { key: 'Tab' })
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus()
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Close' }), { key: 'Tab', shiftKey: true })
    expect(save).toHaveFocus()
  })

  it('edits a logged call with PATCH and leaves an unchanged follow-up alone', async () => {
    let body = null
    server.use(http.patch(`${API}/api/calls/9/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 9 }) }))
    const call = {
      id: 9, direction: 'in', channel: 'whatsapp', purpose: 'other', outcome: 'busy', sentiment: 'neutral', notes: 'Left a message',
      duration_seconds: 120, related_label: 'Adwoa Fabrics', counterpart_name: 'Adwoa Frimpong',
      follow_up_at: new Date(Date.now() + 2 * 86400000).toISOString(),
    }
    const { onSaved } = renderSheet({ call })
    const dialog = await screen.findByRole('dialog', { name: 'Edit call' })
    expect(within(dialog).getByLabelText('Who')).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Busy' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connected' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save call' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(body).toMatchObject({ outcome: 'connected', direction: 'in', channel: 'whatsapp', duration_seconds: 120 })
    expect(body).not.toHaveProperty('follow_up_at')
    expect(body).not.toHaveProperty('counterpart_id')
  })
})
