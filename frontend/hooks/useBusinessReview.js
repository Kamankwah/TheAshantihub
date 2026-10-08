import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/portfolio/businesses/<id>/review/ (kyc.approve or portfolio.manage)
// — the KYC review sheet. Keyed under "portfolio-business" so the live
// updates that refresh a business page (KYC, business and subscription
// events) refresh this too.
export function useBusinessReview(id) {
  return useQuery({
    queryKey: ['portfolio-business', String(id), 'review'],
    queryFn: () => apiFetch(`/api/portfolio/businesses/${id}/review/`),
    enabled: id != null && id !== '',
  })
}
