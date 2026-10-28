import { ghsToPesewas } from '../components/wallet/walletMoney.js'

// The server's unit price times a whole quantity, in whole pesewas (no floats),
// as ledger.sales.price_of does: "80.00" x 3 -> "240.00". Null when the price
// is not a plain GHS amount or the quantity is not a whole number.
export function lineTotalGhs(price, quantity) {
  const unit = ghsToPesewas(price)
  if (unit === null || !Number.isInteger(quantity) || quantity < 0) return null
  const total = unit * quantity
  return `${Math.floor(total / 100)}.${String(total % 100).padStart(2, '0')}`
}
