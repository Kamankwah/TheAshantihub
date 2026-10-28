import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import ReportProblemForm from '../ReportProblemForm.jsx'

const API = 'http://localhost:8000'
const PATH = '/api/ledger/bookings/12/report-problem/'

describe('ReportProblemForm', () => {
  it('enables Send report at five characters and posts the trimmed reason once', async () => {
    const onDone = vi.fn()
    const bodies = []
    server.use(http.post(`${API}${PATH}`, async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({ dispute_id: 3 }, { status: 201 }) }))
    render(<ReportProblemForm path={PATH} idPrefix="stay-12" onDone={onDone} onBack={() => {}} />)
    const send = screen.getByRole('button', { name: 'Send report' })
    expect(send).toBeDisabled()
    fireEvent.change(screen.getByLabelText('What went wrong?'), { target: { value: '  abcd  ' } })
    expect(send).toBeDisabled()
    fireEvent.change(screen.getByLabelText('What went wrong?'), { target: { value: '  abcde  ' } })
    expect(send).toBeEnabled()
    fireEvent.click(send)
    fireEvent.click(send)
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ dispute_id: 3 }))
    expect(bodies).toEqual([{ reason: 'abcde' }])
  })

  it('shows the server refusal verbatim', async () => {
    const onDone = vi.fn()
    server.use(http.post(`${API}${PATH}`, () => HttpResponse.json({ detail: 'A problem is already reported.' }, { status: 409 })))
    render(<ReportProblemForm path={PATH} idPrefix="x" onDone={onDone} onBack={() => {}} />)
    fireEvent.change(screen.getByLabelText('What went wrong?'), { target: { value: 'it was dirty' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A problem is already reported.')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('calls onBack without posting', () => {
    let posted = false
    server.use(http.post(`${API}${PATH}`, () => { posted = true; return HttpResponse.json({}, { status: 201 }) }))
    const onBack = vi.fn()
    render(<ReportProblemForm path={PATH} idPrefix="x" onDone={() => {}} onBack={onBack} />)
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalled()
    expect(posted).toBe(false)
  })
})
