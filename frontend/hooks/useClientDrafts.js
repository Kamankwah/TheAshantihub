import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/portfolio/businesses/<id>/drafts/ — a plain array of the staff
// drafts for one client business: {id, kind, name, payload, status,
// created_by_id, created_by_name, created_at, updated_at, confirmation:
// {state, sent_to_masked, sent_at, expires_at, send_note}}. The server never
// sends a token or a link, and the contact phone in a payload is masked.
export function useClientDrafts(businessId) {
  return useQuery({
    queryKey: ['portfolio-drafts', String(businessId)],
    queryFn: () => apiFetch(`/api/portfolio/businesses/${businessId}/drafts/`),
    enabled: businessId != null,
  })
}

// GET /api/listings/categories/tree/?full=1 — the whole department tree for
// staff drafting a listing (the shopper tree leaves out empty departments).
export function useFullCategoryTree() {
  return useQuery({
    queryKey: ['category-tree', 'full'],
    queryFn: () => apiFetch('/api/listings/categories/tree/?full=1'),
    staleTime: 5 * 60_000,
  })
}
