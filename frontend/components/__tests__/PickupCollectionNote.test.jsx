import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import PickupCollectionNote from '../PickupCollectionNote.jsx'

const mount = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const withAddress = (pickup_office_address) =>
  server.use(http.get('http://localhost:8000/api/core/site-settings/', () => HttpResponse.json({ pickup_office_address })))

describe('PickupCollectionNote', () => {
  it('says address to be confirmed until one is set', async () => {
    mount(<PickupCollectionNote />)
    expect(await screen.findByText('Collect it at the AshantiHub pickup office (address to be confirmed).')).toBeInTheDocument()
  })

  it('shows the address the Super Admin set', async () => {
    withAddress('12 Adum Road, Kumasi')
    mount(<PickupCollectionNote />)
    expect(await screen.findByText('Collect it at the AshantiHub pickup office: 12 Adum Road, Kumasi.')).toBeInTheDocument()
  })

  it('shows the code, the collect-by time in Accra and the do-not-share line', async () => {
    mount(<PickupCollectionNote code="482913" collectBy="2026-10-25T17:30:00Z" />)
    expect(screen.getByLabelText('Collection code')).toHaveTextContent('482913')
    expect(screen.getByText(/Show it at the pickup desk\. Nobody from AshantiHub will ask you for it by phone\./)).toBeInTheDocument()
    expect(screen.getByText('Collect by Sun 25 Oct, 17:30.')).toBeInTheDocument()
    expect(screen.queryByText(/once you have paid/)).not.toBeInTheDocument()
  })

  it('at checkout says a code comes after paying', async () => {
    mount(<PickupCollectionNote />)
    expect(screen.getByText('You get a one-time collection code once you have paid.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Collection code')).not.toBeInTheDocument()
  })

  it('renders no phone or tel link', async () => {
    const { container } = mount(<PickupCollectionNote code="482913" collectBy="2026-10-25T17:30:00Z" />)
    await screen.findByText(/pickup office/)
    expect(container.querySelector('a[href^="tel:"]')).toBeNull()
    expect(container.textContent).not.toMatch(/\d{9,}/)
  })
})
