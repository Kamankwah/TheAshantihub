import { formatAccra } from '../../../lib/bookingTerms.js'
import { D } from '../theme.js'

// The server's VendorText.KIND_CHOICES words. Owner-only: fees appear in this folder, so
// nothing outside components/dashboard/ imports it.
export const TEXT_KIND_WORDS = {
  order_paid: 'Order paid',
  order_released: 'Order released',
  daily_digest: 'Daily digest',
  refund: 'Refund',
  withdrawal: 'Withdrawal',
  balance_negative: 'Balance below zero',
  balance_low: 'Balance low',
  booking_paid: 'Booking paid',
  booking_released: 'Booking released',
  booking_on_hold: 'Booking on hold',
}

export function textKindWord(kind) {
  return TEXT_KIND_WORDS[kind] || 'Money text'
}

export const SALE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'awaiting_call', label: 'Waiting' },
  { value: 'released', label: 'Released' },
  { value: 'refunded', label: 'Refunded' },
]

export function statusColor(row) {
  if (row?.status === 'released') return D.green
  if (row?.status === 'refunded') return D.textDim
  return D.amber
}

// The server's release time as Accra time, or null when it sent none (paid out, on hold).
export function releaseLine(row) {
  if (!row?.release_at) return null
  const at = new Date(row.release_at)
  return Number.isNaN(at.getTime()) ? null : `Releases automatically from ${formatAccra(at)}`
}
