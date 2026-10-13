import { useQuery } from '@tanstack/react-query'
import { apiFetch, apiPost } from '../apiClient.js'

// GET /api/marketing/promos/public/ — {enabled, flash_sales: [{id, name, discount_pct, starts_at, ends_at, live, sold_out,
//   per_customer_limit, stock_left, listings: [{listing, normal_price, sale_price}]}]}.
// `enabled` is the owner's checkout switch (MARKETING_PROMOS_ENABLED): while false the site shows no
// flash-sale price, no countdown and no coupon box.
export function usePublicPromos() {
  return useQuery({ queryKey: ['public-promos'], queryFn: () => apiFetch('/api/marketing/promos/public/'), staleTime: 60_000 })
}

// The flash sale (if any) that includes this listing, with its row.
export function flashFor(promos, listingId) {
  if (!promos?.enabled) return null
  for (const sale of promos.flash_sales || []) {
    const row = sale.listings.find((l) => l.listing === listingId)
    if (row) return { sale, row }
  }
  return null
}

// POST /api/marketing/cart/quote/ — the cart priced with flash sales and an optional coupon code. Writes nothing.
export const quoteCart = (body) => apiPost('/api/marketing/cart/quote/', body)
