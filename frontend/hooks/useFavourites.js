import { useState } from 'react'
import { useWishlist } from './useWishlist.js'

// The heart on a card. A signed-in customer's hearts ARE their server wishlist (so the card,
// the product page and Your Lists always agree); signed-out visitors, staff and business
// accounts (the API would 403 them) keep the original in-memory behaviour. Existing local
// favourites are not migrated. Until the list has loaded a customer's hearts are inert, so
// a tap can never act on a state the server has not confirmed.
export function useFavourites(user, { ready = true } = {}) {
  const isCustomer = user?.accountType === 'customer'
  const wishlist = useWishlist({ enabled: isCustomer && ready })
  const [local, setLocal] = useState([])

  if (!isCustomer) {
    return {
      favourites: local,
      toggleFav: (id) => setLocal((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id])),
      loaded: true,
      error: null,
    }
  }
  const favourites = wishlist.items.map((row) => row.listing?.id).filter((id) => id != null)
  const loaded = wishlist.isSuccess
  const toggleFav = async (id) => {
    if (!loaded) return
    try {
      if (favourites.includes(id)) await wishlist.remove(id)
      else await wishlist.add(id)
    } catch {
      // The heart simply stays as the server last reported it.
    }
  }
  return { favourites, toggleFav, loaded, error: wishlist.error }
}
