import { useQuery } from '@tanstack/react-query'
import { apiFetch, getStoredAuth } from '../apiClient.js'
import { opensLabel } from '../lib/openingFormat.js'
import { useOpening } from './useOpening.js'

// The one buy-disabled rule, used by every buy surface (cart checkout, Add to
// Cart, Book, ticket Buy): disabled while the marketplace is not open AND the
// account cannot buy. `can_buy` comes from GET /api/accounts/me/ (false for a
// customer before opening unless a Super Admin allowlisted them; true for
// owners and staff). A signed-out visitor cannot buy before opening. /me/ is
// only asked while the gate is actually closed, so nothing extra is fetched
// once the marketplace is open (or while the gate is switched off).
// → { canBuy, opensAt, label } — label is "Opens <D Mon>" (Accra) or null.
export function useCanBuy() {
  const { isOpen, opensAt, loading } = useOpening({ tick: false })
  const token = getStoredAuth()?.token ?? null
  const closed = !loading && !isOpen
  const me = useQuery({
    queryKey: ['accounts-me', 'can-buy', token],
    queryFn: () => apiFetch('/api/accounts/me/'),
    enabled: closed && Boolean(token),
    staleTime: 60_000,
  })
  const canBuy = !closed || me.data?.can_buy === true
  return { canBuy, opensAt, label: canBuy ? null : opensLabel(opensAt) }
}
