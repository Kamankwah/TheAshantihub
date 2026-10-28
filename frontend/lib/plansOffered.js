// True only once GET /api/billing/plans/ has answered with an empty list.
// Loading and error states are NOT "none offered": a screen that is still
// waiting (or whose request failed) keeps showing the plan UI it has today.
export function noPlansOffered(plansQuery) {
  return Array.isArray(plansQuery?.data) && plansQuery.data.length === 0
}
