import { useQuery } from '@tanstack/react-query'
import { apiFetch, apiPost } from '../apiClient.js'

// GET /api/listings/categories/tree/ — the shopper view of the department tree:
// [{id, slug, label, icon, kind, is_accommodation, color, children: [...]}],
// only nodes with something live in them or below them, so an empty seeded
// department never shows to a shopper. Shopper-facing pickers and filters use
// this; business and staff forms keep the flat useCategories() list.
export function useCategoryTree() {
  return useQuery({
    queryKey: ['category-tree'],
    queryFn: () => apiFetch('/api/listings/categories/tree/'),
    staleTime: 5 * 60_000,
  })
}

// Where a shopper lands for a category: events open the Events page, every
// other kind the browse page (which includes the category's sub-categories).
export function categoryPath(node) {
  const slug = encodeURIComponent(node.slug)
  return node.kind === 'event' ? `/events?category=${slug}` : `/business?category=${slug}`
}

// POST /api/listings/categories/<id>/visit/ — counts one visit toward "most
// visited categories". Fire and forget: never awaited, never throws.
export function sendCategoryVisit(id) {
  try {
    apiPost(`/api/listings/categories/${id}/visit/`, {}).catch(() => {})
  } catch {
    // A beacon must never disturb the page.
  }
}
