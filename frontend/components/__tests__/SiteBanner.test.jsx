import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../mocks/server.js'
import SiteBanner from '../SiteBanner.jsx'
import FeaturedRow from '../FeaturedRow.jsx'

const API = 'http://localhost:8000'
const mount = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const banner = { id: 5, slot: 'home_strip', title: 'Sell on AshantiHub', alt_text: 'A scout helping a seller', image: 'http://localhost:8000/media/b.jpg', link_path: '/register', sponsored: false }

afterEach(() => vi.unstubAllGlobals())

describe('SiteBanner', () => {
  it('renders nothing when no banner is live', async () => {
    server.use(http.get(`${API}/api/marketing/banners/`, () => HttpResponse.json({ banners: [] })))
    const { container } = mount(<SiteBanner slot="home_strip" />)
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the read fails', async () => {
    server.use(http.get(`${API}/api/marketing/banners/`, () => HttpResponse.json({}, { status: 500 })))
    const { container } = mount(<SiteBanner slot="home_strip" />)
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the banner, counts a click and follows the internal link', async () => {
    const hits = []
    server.use(
      http.get(`${API}/api/marketing/banners/`, () => HttpResponse.json({ banners: [banner] })),
      http.post(`${API}/api/marketing/banners/5/click/`, () => { hits.push('click'); return new HttpResponse(null, { status: 204 }) }),
    )
    const go = vi.fn()
    mount(<SiteBanner slot="home_strip" onNavigate={go} />)
    const button = await screen.findByRole('button', { name: /Sell on AshantiHub/ })
    expect(screen.getByAltText('A scout helping a seller')).toBeInTheDocument()
    fireEvent.click(button)
    expect(go).toHaveBeenCalledWith('/register')
    await waitFor(() => expect(hits).toEqual(['click']))
  })

  it('counts a view once, when half of it is on screen', async () => {
    const views = []
    let trigger
    vi.stubGlobal('IntersectionObserver', class { constructor(cb) { trigger = cb } observe() {} disconnect() {} })
    server.use(
      http.get(`${API}/api/marketing/banners/`, () => HttpResponse.json({ banners: [{ ...banner, sponsored: true }] })),
      http.post(`${API}/api/marketing/banners/5/view/`, () => { views.push(1); return new HttpResponse(null, { status: 204 }) }),
    )
    mount(<SiteBanner slot="home_strip" />)
    await screen.findByText('Sponsored')
    trigger([{ isIntersecting: true, intersectionRatio: 0.2 }])
    await new Promise((r) => setTimeout(r, 30))
    expect(views).toEqual([])
    trigger([{ isIntersecting: true, intersectionRatio: 0.6 }])
    await waitFor(() => expect(views).toEqual([1]))
  })
})

describe('FeaturedRow', () => {
  it('renders nothing with no featured listings and a gold-outlined Featured card otherwise, never a tick for paid', async () => {
    server.use(http.get(`${API}/api/marketing/featured/home/`, () => HttpResponse.json({ listings: [] })))
    const empty = mount(<FeaturedRow />)
    await new Promise((r) => setTimeout(r, 50))
    expect(empty.container).toBeEmptyDOMElement()
    empty.unmount()
    server.use(http.get(`${API}/api/marketing/featured/home/`, () => HttpResponse.json({ listings: [{ id: 3, name: 'Kente stole', main_photo: '', price_amount: '150.00', price_unit: null, category: 'fabrics', business: 'Akosua Ntoma', verified: false }] })))
    const open = vi.fn()
    mount(<FeaturedRow onOpen={open} />)
    fireEvent.click(await screen.findByRole('button', { name: /Kente stole/ }))
    expect(open).toHaveBeenCalledWith(3)
    expect(screen.getByText('Featured', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByText(/Verified/)).toBeNull()
  })
})
