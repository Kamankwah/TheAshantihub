import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

const PARAM_KEYS = ['scope', 'health', 'subscription', 'scout', 'zone', 'unassigned', 'q', 'page']
const isSet = (value) => value !== undefined && value !== null && value !== '' && value !== false

// GET /api/portfolio/businesses/ — a DRF page (read data?.results) plus
// data.summary {total, healthy, needs_attention, at_risk, new, unassigned,
// at_risk_week_ago}. scope: mine (a scout always gets mine) | team | all.
// The previous page stays on screen while a search or filter loads.
export function usePortfolio(params = {}, { enabled = true } = {}) {
  const clean = Object.fromEntries(PARAM_KEYS.filter((key) => isSet(params[key])).map((key) => [key, params[key]]))
  const query = new URLSearchParams(
    Object.entries(clean).map(([key, value]) => [key, value === true ? '1' : String(value)]),
  ).toString()
  return useQuery({
    queryKey: ['portfolio', clean],
    queryFn: () => apiFetch(`/api/portfolio/businesses/${query ? `?${query}` : ''}`),
    placeholderData: keepPreviousData,
    enabled,
  })
}

// GET /api/portfolio/businesses/<id>/ — one business with its listings,
// pending requests, recent calls and assignment history.
export function usePortfolioBusiness(id) {
  return useQuery({
    queryKey: ['portfolio-business', String(id)],
    queryFn: () => apiFetch(`/api/portfolio/businesses/${id}/`),
    enabled: id != null,
  })
}

// GET /api/portfolio/meta/listing-form/?business=<id> — {categories, zones,
// required_answers} for the scout's Add-a-product form.
export function useListingFormMeta(businessId) {
  return useQuery({
    queryKey: ['portfolio-listing-form', String(businessId)],
    queryFn: () => apiFetch(`/api/portfolio/meta/listing-form/?business=${businessId}`),
    enabled: businessId != null,
  })
}

// The scouts a business can be moved to: a Super Admin may pick any active
// scout (GET /api/accounts/scouts/), an Operations lead only their own team
// (GET /api/accounts/staff/team/). Both are plain arrays of the staff list
// shape, and share the cache with useScouts / useMyTeam.
export function useReassignableScouts(auth, { enabled = true } = {}) {
  const everyone = auth?.user?.role === 'super_admin'
  const query = useQuery({
    queryKey: everyone ? ['scouts'] : ['my-team'],
    queryFn: () => apiFetch(everyone ? '/api/accounts/scouts/' : '/api/accounts/staff/team/'),
    enabled,
  })
  const rows = Array.isArray(query.data) ? query.data : query.data?.results || []
  const scouts = rows.filter((staff) => staff.role === 'scout' && staff.status === 'active')
  return { ...query, scouts }
}
