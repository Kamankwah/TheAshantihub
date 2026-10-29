import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiPost } from '../apiClient.js'
import { apiErrorMessage } from '../lib/apiErrorMessage.js'

const FALLBACK = 'Could not add this item to your cart.'

// POST /api/cart/items/bulk/ answers a line problem as {lines:[{index, detail}]} and a listing-level one as
// {detail: "..."} or {detail: ["..."]}; show the server's own words, line messages joined.
export function bulkErrorMessage(err) {
  const body = err?.body
  if (body && Array.isArray(body.lines)) {
    const messages = body.lines.map((l) => (typeof l === 'string' ? l : l?.detail)).filter(Boolean)
    if (messages.length) return messages.join(' ')
  }
  if (body && Array.isArray(body.detail) && typeof body.detail[0] === 'string') return body.detail[0]
  return apiErrorMessage(err, FALLBACK)
}

// Add to cart from the product page. `selection` is {[variantId]: quantity}: with entries it is ONE all-or-nothing bulk
// request; an empty selection is a listing without variants, which posts the plain single-item endpoint. Plain
// apiPost in the handler (no useMutation): a failure sets `actionError` and changes nothing; a success invalidates the
// cart and the cart guard. `add` resolves true on success, false otherwise, and a click while `busy` is ignored.
export function useAddToCartBulk() {
  const queryClient = useQueryClient()
  const [actionError, setActionError] = useState(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)

  async function add(listingId, selection) {
    if (inFlight.current) return false
    const lines = Object.entries(selection || {})
      .map(([variant, quantity]) => ({ variant: Number(variant), quantity: Number(quantity) }))
      .filter((l) => l.quantity > 0)
    inFlight.current = true
    setBusy(true)
    setActionError(null)
    try {
      if (lines.length > 0) await apiPost('/api/cart/items/bulk/', { listing: listingId, lines })
      else await apiPost('/api/cart/items/', { listing: listingId, quantity: 1 })
      queryClient.invalidateQueries({ queryKey: ['cart'] })
      queryClient.invalidateQueries({ queryKey: ['cart-guard'] })
      return true
    } catch (err) {
      setActionError(bulkErrorMessage(err))
      return false
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return { add, actionError, busy, clearError: () => setActionError(null) }
}
