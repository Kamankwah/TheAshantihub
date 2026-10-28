import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// A business owner's money reads (Plan 4F). Keys sit under ['wallet','vendor', …], so
// invalidating ['wallet','vendor'] refetches every one of them and the overview.
// A 4xx (a bad date range, `ledger_off`) shows at once; anything else retries twice.
const retry = (count, error) => !(error?.status >= 400 && error?.status < 500) && count < 2

function path(base, params) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== '' && value !== null && value !== undefined) query.set(key, String(value))
  }
  const text = query.toString()
  return text ? `${base}?${text}` : base
}

function salesParams(status, dateFrom, dateTo, page) {
  return { status: status === 'all' ? '' : status, date_from: dateFrom, date_to: dateTo, page: page === 1 ? '' : page }
}

// GET /api/wallet/vendor/sales/ — PAGINATED: the DRF envelope, read as `data.results` / `data.next`.
export function useVendorSales({ status = 'all', dateFrom = '', dateTo = '', page = 1, enabled = true } = {}) {
  return useQuery({
    queryKey: ['wallet', 'vendor', 'sales', status, dateFrom, dateTo, page],
    queryFn: () => apiFetch(path('/api/wallet/vendor/sales/', salesParams(status, dateFrom, dateTo, page))),
    enabled,
    retry,
  })
}

// GET /api/wallet/vendor/bookings/ — PAGINATED (services, stays and tickets): the DRF envelope.
export function useVendorBookings({ status = 'all', dateFrom = '', dateTo = '', page = 1, enabled = true } = {}) {
  return useQuery({
    queryKey: ['wallet', 'vendor', 'bookings', status, dateFrom, dateTo, page],
    queryFn: () => apiFetch(path('/api/wallet/vendor/bookings/', salesParams(status, dateFrom, dateTo, page))),
    enabled,
    retry,
  })
}

// GET /api/wallet/vendor/daily/ — a PLAIN object: `{from, to, days, totals}`.
export function useVendorDaily({ dateFrom = '', dateTo = '', enabled = true } = {}) {
  return useQuery({
    queryKey: ['wallet', 'vendor', 'daily', dateFrom, dateTo],
    queryFn: () => apiFetch(path('/api/wallet/vendor/daily/', { date_from: dateFrom, date_to: dateTo })),
    enabled,
    retry,
  })
}

// GET /api/wallet/vendor/fees/ — a PLAIN object: `{categories, fee_base, fee_cap}`; with `amount`
// set the server also quotes the fee on it (`?amount=&category=`).
export function useVendorFees({ amount = null, category = null, enabled = true } = {}) {
  return useQuery({
    queryKey: ['wallet', 'vendor', 'fees', amount, category],
    queryFn: () => apiFetch(path('/api/wallet/vendor/fees/', amount ? { amount, category } : {})),
    enabled,
    retry,
  })
}

// GET /api/wallet/vendor/texts/ — a PLAIN object: `{order_texts, daily_digest, phone, note, recent}`.
export function useVendorTexts({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['wallet', 'vendor', 'texts'],
    queryFn: () => apiFetch('/api/wallet/vendor/texts/'),
    enabled,
    retry,
  })
}
