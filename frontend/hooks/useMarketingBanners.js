import { useQuery } from '@tanstack/react-query'
import { apiFetch, apiPost } from '../apiClient.js'

// Marketing canvas 12 (Banners) and 13 (Featured listings), plus the public site's banner and
// featured-row reads. Query keys start with 'marketing-'.

// GET /api/marketing/site-banners/ — {banners: [{id, slot, slot_label, category, title, alt_text, image, link_path,
//   sponsored, internal_note, starts_at, ends_at, state: draft|waiting|approved|rejected|taken_down,
//   phase: live|scheduled|ended|'', approval_id, approved_by, approved_at, return_note, views, clicks, ctr|null,
//   created_by, created_at}], slots: [{key, label, size}], categories: [{id, slug, label}], counters_note}
export function useStaffBanners() {
  return useQuery({ queryKey: ['marketing-banners'], queryFn: () => apiFetch('/api/marketing/site-banners/') })
}

// GET /api/marketing/featured/grid/?from= — {weeks: [{start, label, current}], rows: [{slot_key, kind, name, position,
//   category, weekly_price, cells: [{week_start, state: open|booked|waiting|held|stopped, booking_id, business,
//   listing_name, promotion_id, reason}]}], summary: {week_label, booked, waiting, list_price_total},
//   prices: {slots: [{key, label, weekly_price, places, per}], promotion_daily_rate, note}, categories, slots}
export function useFeaturedGrid(from = '') {
  return useQuery({ queryKey: ['marketing-featured-grid', from], queryFn: () => apiFetch(`/api/marketing/featured/grid/${from ? `?from=${from}` : ''}`) })
}

// GET /api/marketing/featured/candidates/?q= — {promotions: [{promotion_id, status, listing_id, listing_name, business,
//   paid_days, weeks_paid, weeks_placed, blockers: [{code, message}]}]}
export function useFeaturedCandidates(q = '', enabled = true) {
  return useQuery({ queryKey: ['marketing-featured-candidates', q], enabled, queryFn: () => apiFetch(`/api/marketing/featured/candidates/?q=${encodeURIComponent(q)}`) })
}

// Public: live approved banners for a slot. Anyone may read; the answer holds no staff names or counters.
export function usePublicBanners(slot, category = '') {
  return useQuery({
    queryKey: ['marketing-public-banners', slot, category],
    queryFn: () => apiFetch(`/api/marketing/banners/?slot=${slot}${category ? `&category=${encodeURIComponent(category)}` : ''}`),
    staleTime: 60_000,
    retry: false,
  })
}

// Public: listings on the featured row right now (home, or a category's top).
export function usePublicFeatured(category = '') {
  return useQuery({
    queryKey: ['marketing-public-featured', category],
    queryFn: () => apiFetch(`/api/marketing/featured/home/${category ? `?category=${encodeURIComponent(category)}` : ''}`),
    staleTime: 60_000,
    retry: false,
  })
}

// Count-only beacons. Fire and forget: never awaited by the page, never throw.
export function sendBannerBeacon(id, kind) {
  try {
    apiPost(`/api/marketing/banners/${id}/${kind}/`, {}).catch(() => {})
  } catch {
    // A beacon must never disturb the page.
  }
}
