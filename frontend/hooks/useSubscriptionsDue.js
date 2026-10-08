import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/portfolio/subscriptions-due/?scope=team|all (portfolio.manage) —
// {overdue: [portfolio item + notices], paused: [the same], cleared: [{id,
// business_name, paid_on_day, at}]}. Not paginated. Live updates refresh it
// through the "subscriptions-due" key.
export function useSubscriptionsDue(scope = 'team') {
  return useQuery({
    queryKey: ['subscriptions-due', scope],
    queryFn: () => apiFetch(`/api/portfolio/subscriptions-due/?scope=${encodeURIComponent(scope)}`),
  })
}
