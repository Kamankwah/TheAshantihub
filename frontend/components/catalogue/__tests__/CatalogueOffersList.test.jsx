import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../mocks/server.js'
import CatalogueOffersList from '../CatalogueOffersList.jsx'

const offer = (o) => ({
  listing_id: 11, name: 'Milo', price_amount: '1300.00', price_now: '1250.00', price_basis: 'discount', price_unit: 'per tin',
  condition: 'new', business_name: 'Kofi Stores', verified: true, zone: 'Adum', available_quantity: 7, ...o,
})

describe('CatalogueOffersList verified mark', () => {
  it('test_verified_mark_only_when_the_server_says_verified', async () => {
    server.use(http.get('http://localhost:8000/api/catalogue/products/:id/offers/', () => HttpResponse.json({
      catalogue_product: { id: 1 }, your_listings: [], truncated: false,
      offers: [offer({}), offer({ listing_id: 12, business_name: 'Yaw Traders', verified: false })],
    })))
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CatalogueOffersList productId={1} /></QueryClientProvider>)
    expect(await screen.findByText('Yaw Traders')).toBeInTheDocument()
    expect(screen.getByText('Kofi Stores')).toBeInTheDocument()
    expect(screen.getAllByText(/Verified business/)).toHaveLength(1)
  })
})
