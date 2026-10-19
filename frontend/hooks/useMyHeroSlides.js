import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/hero/mine/slides/ — the calling business's own dated hero slides, newest first (plain array of the
// moderation shape: status pending|approved|rejected, rejection_reason, starts_at, ends_at, youtube_id, ...).
export function useMyHeroSlides(enabled = true) {
  return useQuery({
    queryKey: ['my-hero-slides'],
    queryFn: () => apiFetch('/api/hero/mine/slides/'),
    enabled,
  })
}
