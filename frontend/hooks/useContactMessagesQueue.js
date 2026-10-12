import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/core/contact-messages/ — staff-only (contact_messages.manage
// permission). Paginated ({count, next, previous, results}), same
// convention as useReviewsModerationQueue.js (as opposed to
// useModerationQueue.js/useHeroModerationQueue.js's unpaginated arrays) —
// callers must read `data?.results`, not `data` directly.
// Optional filters: status (new|read|resolved|open), category, page. Each
// result carries `match` — the business the sender is matched to by email or
// phone ({business_id, business, account_manager, kyc_status}) or null.
export function useContactMessagesQueue({ status = '', category = '', page = 1 } = {}) {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (category) params.set('category', category)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return useQuery({
    queryKey: ['contact-messages-queue', status, category, page],
    queryFn: () => apiFetch(`/api/core/contact-messages/${query ? `?${query}` : ''}`),
    placeholderData: keepPreviousData,
  })
}
