// Pure catalogue helpers. Nothing here decides stock status, cover or price:
// it only words and formats what the server sent.
import { formatGhs } from '../wallet/walletMoney.js'

export const STOCK_COUNT_HELP = "Don't count stock (made to order)? Leave the count empty. A count of 0 means sold out."
export const CONDITION_LABEL = { new: 'New', used: 'Used', refurbished: 'Refurbished' }
export const PRICE_BASIS_LABEL = { regular: '', discount: 'Discounted price', flash_sale: 'Flash sale price' }

const STANDARD_LENGTHS = [8, 12, 13, 14]

// The key is stored as 14 digits; show the shortest standard length that holds it.
export function displayBarcode(key) {
  if (!key) return ''
  const digits = String(key).replace(/^0+/, '')
  const length = STANDARD_LENGTHS.find((n) => n >= digits.length) ?? digits.length
  return digits.padStart(length, '0')
}

// Mirrors cart.guard.kind_of_category being in DELIVERABLE.
export function isGoodsCategory(category) {
  if (!category) return false
  return !category.is_accommodation && (Boolean(category.is_food) || category.kind === 'product')
}

// "1250.00" -> "GH₵ 1,250.00" (string maths only, via the wallet formatter).
export function formatPrice(str) {
  return formatGhs(str)
}

export function coverSentence(row, settings) {
  if (!row) return ''
  if (row.sold_out) return 'Sold out.'
  if (row.basis === 'sales') {
    return `About ${row.days_of_cover} days of sales left: ${row.units_sold} sold in the last ${row.days_on_sale} day(s).`
  }
  if (row.basis === 'fallback') {
    return `${row.stock} left. No sales in the last ${settings?.window_days} days, so it counts as low at ${row.line} or fewer.`
  }
  if (row.basis === 'own_threshold') return `${row.stock} left. Your alert line is ${row.line}.`
  return ''
}

export function catalogueCode(error) {
  return error?.body?.code ?? null
}
