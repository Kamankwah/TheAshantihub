import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EventsCtaBand } from './components/ui/events-cta-band.tsx'

const IMAGE_URL = 'https://example.com/akwasidae.jpg'

function renderBand(props = {}) {
  return render(<EventsCtaBand imageUrl={IMAGE_URL} onSubmitEvent={vi.fn()} {...props} />)
}

describe('EventsCtaBand', () => {
  it('renders the pitch copy and image', () => {
    renderBand()
    expect(screen.getByText('Hosting an event?')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /akwasidae festival/i })).toBeInTheDocument()
  })

  it('uses the passed-in imageUrl as the background image', () => {
    renderBand()
    const image = screen.getByRole('img', { name: /akwasidae festival/i })
    expect(image).toHaveStyle({ backgroundImage: `url(${IMAGE_URL})` })
  })

  it('calls onSubmitEvent when the Submit an Event button is clicked', () => {
    const onSubmitEvent = vi.fn()
    renderBand({ onSubmitEvent })

    fireEvent.click(screen.getByText('Submit an Event →'))
    expect(onSubmitEvent).toHaveBeenCalledTimes(1)
  })
})
