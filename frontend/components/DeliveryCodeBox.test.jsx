import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import DeliveryCodeBox from './DeliveryCodeBox.jsx'

describe('DeliveryCodeBox', () => {
  it.each(['picked_up', 'at_customer'])('shows the code large from pickup onwards (%s)', (status) => {
    render(<DeliveryCodeBox code="2468" assignmentStatus={status} />)
    const box = screen.getByTestId('delivery-code-box')
    expect(box).toHaveTextContent('Delivery code')
    expect(screen.getByLabelText('Delivery code 2 4 6 8')).toBeInTheDocument()
    expect(box).toHaveTextContent('Give this code to the rider only when your order is in your hands.')
    expect(box).toHaveTextContent('AshantiHub will never ask for it by phone or message.')
  })

  it.each(['assigned', 'accepted', 'at_pickup', 'delivered', 'failed', 'confirmed', null, undefined])('is hidden while the assignment is %s', (status) => {
    const { container } = render(<DeliveryCodeBox code="2468" assignmentStatus={status} />)
    expect(container).toBeEmptyDOMElement()
  })

  it.each([null, undefined, ''])('is hidden when the server sends no code (%s)', (code) => {
    const { container } = render(<DeliveryCodeBox code={code} assignmentStatus="at_customer" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('offers no contact or call action and no pickup code', () => {
    render(<DeliveryCodeBox code="2468" assignmentStatus="at_customer" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText(/pickup code/i)).not.toBeInTheDocument()
  })
})
