import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { ContactEnquiryForm } from './components/ui/contact-enquiry-form.tsx'
import { server } from './mocks/server.js'

function fillRequiredFields() {
  fireEvent.change(screen.getByPlaceholderText('Your full name'), { target: { value: 'Ama Owusu' } })
  fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'ama@example.com' } })
  fireEvent.change(screen.getByPlaceholderText("What's this about?"), { target: { value: 'Order question' } })
  fireEvent.change(screen.getByPlaceholderText('Tell us more…'), { target: { value: 'When will my order arrive?' } })
}

describe('ContactEnquiryForm', () => {
  it('disables submit until the required fields are filled', () => {
    render(<ContactEnquiryForm />)
    expect(screen.getByText('Send Message')).toBeDisabled()
    fillRequiredFields()
    expect(screen.getByText('Send Message')).not.toBeDisabled()
  })

  it('submits and shows a confirmation on success', async () => {
    let postedBody = null
    server.use(
      http.post('http://localhost:8000/api/core/contact/', async ({ request }) => {
        postedBody = await request.json()
        return HttpResponse.json({ id: 1, ...postedBody, status: 'new' }, { status: 201 })
      }),
    )
    render(<ContactEnquiryForm />)
    fillRequiredFields()
    fireEvent.click(screen.getByText('Send Message'))

    await screen.findByText('Message sent!')
    expect(postedBody).toEqual({
      category: 'general',
      name: 'Ama Owusu',
      email: 'ama@example.com',
      phone: '',
      subject: 'Order question',
      message: 'When will my order arrive?',
    })
  })

  it('sets the category from the tab buttons before submitting', async () => {
    let postedBody = null
    server.use(
      http.post('http://localhost:8000/api/core/contact/', async ({ request }) => {
        postedBody = await request.json()
        return HttpResponse.json({ id: 1, ...postedBody, status: 'new' }, { status: 201 })
      }),
    )
    render(<ContactEnquiryForm />)
    fireEvent.click(screen.getByText('Sales'))
    fillRequiredFields()
    fireEvent.click(screen.getByText('Send Message'))

    await waitFor(() => expect(postedBody?.category).toBe('sales'))
  })

  it('shows a readable error message on failure', async () => {
    server.use(
      http.post('http://localhost:8000/api/core/contact/', () => HttpResponse.json({ detail: 'Server error' }, { status: 500 })),
    )
    render(<ContactEnquiryForm />)
    fillRequiredFields()
    fireEvent.click(screen.getByText('Send Message'))

    await screen.findByText('Could not send your message. Please try again.')
  })
})
