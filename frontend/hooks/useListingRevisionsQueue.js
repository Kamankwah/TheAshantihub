import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// Staff queue of owners' changes to live listings. `status` (pending |
// approved | rejected) is the backend's `?status=` param. The backing view
// (RevisionPendingQueueView) sets no pagination class and the project has no
// default one, so `data` is a PLAIN ARRAY (not `data.results`) - the unpaginated
// side of frontend/CLAUDE.md's split. ModerationQueueTabs' itemsOf() copes with
// either shape anyway.
export function useListingRevisionsQueue({ status = 'pending', enabled = true } = {}) {
  return useQuery({
    queryKey: ['listing-revisions-queue', status],
    queryFn: () => apiFetch(`/api/listings/revisions/pending/?status=${status}`),
    enabled,
  })
}

// One revision with its `diff` ({fields, media, variants}); fetched per row only
// while a pending row needs its before/after.
export function useListingRevisionDetail(id, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['listing-revision', id],
    queryFn: () => apiFetch(`/api/listings/revisions/${id}/`),
    enabled: enabled && id != null,
  })
}
