import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// Super Admin marketplace oversight (SA-5). Every list is a DRF page
// ({count, next, previous, results}); the *counts hooks feed the KPI strips
// and cover the whole marketplace, whatever the list filters say. Keys start
// with "sa-" so one prefix is what live updates refetch.

export const queryString = (params = {}) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, value]) => value !== '' && value != null && value !== false)
      .map(([key, value]) => [key, value === true ? '1' : String(value)]),
  ).toString()

const list = (key, path) =>
  function useList(params = {}, { enabled = true } = {}) {
    const q = queryString(params)
    return useQuery({
      queryKey: [key, 'list', q],
      queryFn: () => apiFetch(`${path}${q ? `?${q}` : ''}`),
      placeholderData: keepPreviousData,
      enabled,
    })
  }

const counts = (key, path) =>
  function useCounts({ enabled = true } = {}) {
    return useQuery({ queryKey: [key, 'counts'], queryFn: () => apiFetch(path), enabled })
  }

// GET /api/portfolio/businesses/?scope=all&kyc=&flag=… (see usePortfolio) is the Businesses list.
// GET /api/portfolio/businesses/counts/ — {total, live, activated_this_month, kyc_waiting, overdue, paused,
//   at_risk, fraud_open, fraud_open_names, suspended, pause_enabled}
export const useBusinessCounts = counts('sa-businesses', '/api/portfolio/businesses/counts/')

// GET /api/portfolio/businesses/<id>/oversight/ — {payments_simulated, sales_month, rating, open_disputes,
//   orders_total, orders, disputes, conversations, payments, open_fraud_flags}
export function useBusinessOversight(id) {
  return useQuery({
    queryKey: ['sa-businesses', 'oversight', String(id)],
    queryFn: () => apiFetch(`/api/portfolio/businesses/${id}/oversight/`),
    enabled: id != null,
  })
}

// GET /api/marketplace/customers/?q=&status=&case=&page=
export const useCustomers = list('sa-customers', '/api/marketplace/customers/')
export const useCustomerCounts = counts('sa-customers', '/api/marketplace/customers/counts/')
export function useCustomer(id) {
  return useQuery({
    queryKey: ['sa-customers', 'one', String(id)],
    queryFn: () => apiFetch(`/api/marketplace/customers/${id}/`),
    enabled: id != null,
  })
}

// GET /api/marketplace/listings/?q=&status=&type=&added_by=&category=&page=
export const useSaListings = list('sa-listings', '/api/marketplace/listings/')
export const useSaListingCounts = counts('sa-listings', '/api/marketplace/listings/counts/')
// GET /api/listings/moderation/{id}/ — everything the owner submitted, for the review sheet.
export function useListingForReview(id) {
  return useQuery({
    queryKey: ['sa-listings', 'review', String(id)],
    queryFn: () => apiFetch(`/api/listings/moderation/${id}/`),
    enabled: id != null,
  })
}
export function useListingHistory(id) {
  return useQuery({
    queryKey: ['sa-listings', 'history', String(id)],
    queryFn: () => apiFetch(`/api/marketplace/listings/${id}/history/`),
    enabled: id != null,
  })
}

// GET /api/marketplace/orders/?q=&payment=&delivery=&case=&rider=&day=&from=&to=&page=
export const useSaOrders = list('sa-orders', '/api/marketplace/orders/')
export const useSaOrderCounts = counts('sa-orders', '/api/marketplace/orders/counts/')
export function useSaOrder(id) {
  return useQuery({
    queryKey: ['sa-orders', 'one', String(id)],
    queryFn: () => apiFetch(`/api/marketplace/orders/${id}/`),
    enabled: id != null,
  })
}

// GET /api/marketplace/events/?q=&show=&business=&page=
export const useSaEvents = list('sa-events', '/api/marketplace/events/')
export const useSaEventCounts = counts('sa-events', '/api/marketplace/events/counts/')

// GET /api/marketplace/disputes/?scope=&team=&reason=&business=&q=&page=
export const useSaDisputes = list('sa-disputes', '/api/marketplace/disputes/')
export const useSaDisputeCounts = counts('sa-disputes', '/api/marketplace/disputes/counts/')
