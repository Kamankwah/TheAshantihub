import { http, HttpResponse } from 'msw'

// Fixtures and URLs for the marketplace home (Plan M1 Task 10). The defaults in
// mocks/handlers.js answer "nothing live" for every home feed; a test installs
// these with server.use(...) when it needs content.
const API = 'http://localhost:8000'
export const TREE_URL = `${API}/api/listings/categories/tree/`
export const SEARCH_URL = `${API}/api/storefront/search/`
export const DEALS_URL = `${API}/api/storefront/deals/`
export const HOME_FEED_URL = `${API}/api/storefront/home/`
export const HERO_URL = `${API}/api/hero/active/`
export const BANNERS_URL = `${API}/api/marketing/banners/`
export const VISIT_URL = `${API}/api/listings/categories/:id/visit/`

export const TREE = [
  { id: 10, slug: 'electronics', label: 'Electronics', icon: '📱', kind: 'product', is_accommodation: false, color: '#000080',
    children: [{ id: 11, slug: 'electronics-headphones', label: 'Headphones', icon: '🎧', kind: 'product', is_accommodation: false, color: '#000080', children: [] }] },
  { id: 20, slug: 'books', label: 'Books', icon: '📚', kind: 'product', is_accommodation: false, color: '#006400', children: [] },
  { id: 30, slug: 'hotels', label: 'Hotels', icon: '🏨', kind: 'service', is_accommodation: true, color: '#000080', children: [] },
  { id: 40, slug: 'concerts', label: 'Concerts', icon: '🎤', kind: 'event', is_accommodation: false, color: '#CC0000', children: [] },
]

export const HERO_SLIDES = [
  { id: 1, media_type: 'image', image: 'https://cdn.test/kente.jpg', video_url: null, youtube_id: null, title: 'Kente week', caption: 'Woven in Bonwire', link_path: '/business/7', listing_id: 7 },
  { id: 2, media_type: 'video', image: null, video_url: 'https://cdn.test/market.mp4', youtube_id: null, title: 'Kejetia at dawn', caption: '', link_path: null, listing_id: null },
  { id: 3, media_type: 'video', image: null, video_url: null, youtube_id: 'abc123XYZ00', title: 'Festival film', caption: '', link_path: null, listing_id: null },
]

export const DEALS = [
  { id: 101, name: 'Kente stole', photo: null, category_label: 'Clothing', price_amount: '100.00', sale_price: '80.00', was_price: '100.00', discount_percent: 20, sponsored: false, review_count: 0, avg_rating: null },
  { id: 102, name: 'Shea butter', photo: null, category_label: 'Beauty', price_amount: '70.00', sale_price: '50.00', was_price: null, discount_percent: null, sponsored: false, review_count: 0, avg_rating: null },
  { id: 103, name: 'Clay pot', photo: null, category_label: 'Home', price_amount: '30.00', sale_price: null, was_price: null, discount_percent: null, sponsored: true, review_count: 0, avg_rating: null },
]

export const MOST_VISITED = [
  { id: 10, slug: 'electronics', label: 'Electronics', icon: '📱' },
  { id: 20, slug: 'books', label: 'Books', icon: '📚' },
]

export const json = (url, body, method = 'get') => http[method](url, () => HttpResponse.json(body))

export function flashBanner(fields = {}) {
  return http.get(BANNERS_URL, ({ request }) => {
    const slot = new URL(request.url).searchParams.get('slot')
    if (slot !== 'flash') return HttpResponse.json({ banners: [] })
    return HttpResponse.json({ banners: [{ id: 5, slot: 'flash', title: 'Flash', alt_text: '', image: null, link_path: null, sponsored: false, message: 'Kente week: 20% off woven stoles', countdown_ends_at: null, ...fields }] })
  })
}

// Every home feed filled at once (StorefrontHome tests).
export function fullHome() {
  return [
    json(TREE_URL, TREE),
    json(HERO_URL, HERO_SLIDES),
    json(DEALS_URL, DEALS),
    json(HOME_FEED_URL, { most_visited: MOST_VISITED, ranked: true }),
    flashBanner(),
  ]
}
