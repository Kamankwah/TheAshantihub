import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// Public feeds for the marketplace home (Plan M1). Every one is public; a
// section whose feed is empty or fails renders nothing, so no hook here
// retries a failure into a visible spinner.

export const SEARCH_GROUPS = [
  { key: 'products', label: 'Products' },
  { key: 'services', label: 'Services' },
  { key: 'stays', label: 'Stays' },
  { key: 'events', label: 'Events' },
]
export const MIN_SEARCH = 2

// GET /api/storefront/search/?q=&category= → {products, services, stays, events},
// rows {id, kind, name, price, photo, category_label}. Asked only for 2+
// characters (the server answers empty lists below that anyway).
export function useStorefrontSearch(q, category = '') {
  const term = (q || '').trim()
  return useQuery({
    queryKey: ['storefront-search', term, category],
    queryFn: () => {
      const params = new URLSearchParams({ q: term })
      if (category) params.set('category', category)
      return apiFetch(`/api/storefront/search/?${params}`)
    },
    enabled: term.length >= MIN_SEARCH,
    staleTime: 30_000,
    retry: false,
  })
}

// GET /api/storefront/deals/ → [{id, name, photo, category_label, price_amount,
// sale_price|null, was_price|null, discount_percent|null, sponsored, ...}].
export function useDeals() {
  return useQuery({
    queryKey: ['storefront-deals'],
    queryFn: () => apiFetch('/api/storefront/deals/'),
    staleTime: 60_000,
    retry: false,
  })
}

// GET /api/storefront/home/ → {most_visited: [{id, slug, label, icon}]}.
export function useHomeFeed() {
  return useQuery({
    queryKey: ['storefront-home'],
    queryFn: () => apiFetch('/api/storefront/home/'),
    staleTime: 5 * 60_000,
    retry: false,
  })
}

// "GH₵ 1,250.00" — the one money format on the home (dark brown, tabular).
export function cedis(value) {
  const n = Number(value)
  if (value == null || value === '' || !Number.isFinite(n)) return null
  return `GH₵ ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
