import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/portfolio/leaderboard/[?month=YYYY-MM] — the scout's team ranked by activations.
//   {month, as_of, lead: {id, name}|null,
//    rows: [{name, areas: [zone], activations, leave_days, rank, is_me, most_improved}],
//    team_total, my_rank, my_count, gap: {name, count}|null,
//    most_improved: {name, now, then, as_of, then_month}|null}
// Counts only; never another scout's money. The key's first element is the one live updates publish.
export function useLeaderboard(month) {
  return useQuery({
    queryKey: ['leaderboard', month ?? null],
    queryFn: () => apiFetch(month ? `/api/portfolio/leaderboard/?month=${encodeURIComponent(month)}` : '/api/portfolio/leaderboard/'),
  })
}
