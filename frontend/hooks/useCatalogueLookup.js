import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/catalogue/products/?q= or ?barcode= -> {results, truncated}.
// `term` is {q}, {barcode} or null; nothing is asked for an empty value.
export function useCatalogueSearch(term, { enabled = true } = {}) {
  const field = term?.barcode ? 'barcode' : 'q'
  const value = String(term?.[field] ?? '').trim()
  return useQuery({
    queryKey: ['catalogue-products', term],
    queryFn: () => apiFetch(`/api/catalogue/products/?${field}=${encodeURIComponent(value)}`),
    enabled: enabled && value !== '',
    retry: false,
  })
}

// GET /api/catalogue/products/{id}/offers/ -> {catalogue_product, your_listings, offers, truncated}
export function useCatalogueProductOffers(productId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['catalogue-product-offers', productId],
    queryFn: () => apiFetch(`/api/catalogue/products/${productId}/offers/`),
    enabled: enabled && productId != null,
  })
}
