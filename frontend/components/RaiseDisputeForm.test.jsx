import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import RaiseDisputeForm from './RaiseDisputeForm.jsx'
import { server } from '../mocks/server.js'

const DISPUTE_URL = 'http://localhost:8000/api/orders/42/dispute/'

function openForm() {
  render(<RaiseDisputeForm orderId={42} />)
  fireEvent.click(screen.getByRole('button', { name: 'Raise a dispute' }))
}

describe('RaiseDisputeForm', () => {
  it('starts as a single button and opens a form with the five reasons', () => {
    render(<RaiseDisputeForm orderId={42} />)
    expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Raise a dispute' }))

    const options = Array.from(screen.getByLabelText('Reason').options).map((o) => o.textContent)
    expect(options).toEqual(['Order issue', 'Payment issue', 'Delivery issue', 'Quality issue', 'Other'])
    expect(screen.getByLabelText('What went wrong?')).toBeInTheDocument()
  })

  it("won't send without a description", () => {
    openForm()
    expect(screen.getByRole('button', { name: 'Send dispute' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('What went wrong?'), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Send dispute' })).toBeDisabled()
  })

  it('sends the reason and description, then confirms Support will follow up', async () => {
    let body = null
    server.use(http.post(DISPUTE_URL, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ id: 7, status: 'open' }, { status: 201 })
    }))
    openForm()
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'delivery_issue' } })
    fireEvent.change(screen.getByLabelText('What went wrong?'), { target: { value: 'The parcel never arrived.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send dispute' }))

    expect(await screen.findByText(/Our team will look into this and contact you through Support/)).toBeInTheDocument()
    expect(body).toEqual({ reason: 'delivery_issue', description: 'The parcel never arrived.' })
    expect(screen.queryByLabelText('What went wrong?')).not.toBeInTheDocument()
  })

  it('keeps the form and says so when sending fails', async () => {
    server.use(http.post(DISPUTE_URL, () => HttpResponse.json({ detail: 'Server error' }, { status: 500 })))
    openForm()
    fireEvent.change(screen.getByLabelText('What went wrong?'), { target: { value: 'Wrong colour.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send dispute' }))

    expect(await screen.findByText('Could not send your dispute. Please try again.')).toBeInTheDocument()
    expect(screen.getByLabelText('What went wrong?')).toHaveValue('Wrong colour.')
  })

  it('cancel closes the form without sending', () => {
    openForm()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Raise a dispute' })).toBeInTheDocument()
  })
})
