import { useRef, useState } from 'react'
import { useWishlist } from './useWishlist.js'

// The heart on a card. A signed-in customer's hearts ARE their server wishlist (so the card,
// the product page and Your Lists always agree); signed-out visitors, staff and business
// accounts (the API would 403 them) keep the original in-memory behaviour. Existing local
// favourites are not migrated. Until the list has loaded a customer's hearts do not toggle (a tap on a
// failed first read tries the read again), so a tap can never act on a state the server has not confirmed.
// `failedId` is the listing whose last toggle failed (cleared by the next try); one request per id at a time.
export function useFavourites(user, { ready = true } = {}) {
  const isCustomer = user?.accountType === 'customer'
  const wishlist = useWishlist({ enabled: isCustomer && ready })
  const [local, setLocal] = useState([])
  const [failedId, setFailedId] = useState(null)
  const inFlight = useRef(new Set())

  if (!isCustomer) {
    return {
      favourites: local,
      toggleFav: (id) => setLocal((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id])),
      loaded: true,
      error: null,
      failedId: null,
    }
  }
  const favourites = wishlist.items.map((row) => row.listing?.id).filter((id) => id != null)
  const loaded = wishlist.isSuccess
  const toggleFav = async (id) => {
    if (!loaded) {
      if (wishlist.isError) wishlist.refetch()
      return
    }
    if (inFlight.current.has(id)) return
    inFlight.current.add(id)
    setFailedId(null)
    try {
      if (favourites.includes(id)) await wishlist.remove(id)
      else await wishlist.add(id)
    } catch {
      // The heart stays as the server last reported it, and says the tap did not work.
      setFailedId(id)
    } finally {
      inFlight.current.delete(id)
    }
  }
  return { favourites, toggleFav, loaded, error: wishlist.error, failedId }
}
