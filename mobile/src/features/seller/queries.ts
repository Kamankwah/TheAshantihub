import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
import type { Listing } from "../browse/types";

export type Seller = {
  id: number;
  name: string;
  since: string | null;
  counts: { products?: number; services?: number; stays?: number; events?: number };
};

export type EventSummary = {
  id: number;
  name: string;
  event_date: string | null;
  address?: string | null;
  going_count?: number;
  has_tickets?: boolean;
};

export type EventDetail = EventSummary & {
  description?: string;
  organizer?: { name?: string } | string | null;
  media?: { id?: number; url?: string; image?: string }[];
  avg_rating?: number | null;
  review_count?: number | null;
  refund_until_days_before?: number | null;
};

type Paged<T> = { results?: T[]; next?: string | null };

/** One page of a seller's rows at a time (20), so a big seller never costs a long chain of requests. */
function sellerPages<T>(key: string, path: string, seller: string | number, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [key, String(seller)],
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api<Paged<T>>(path, { auth: false, query: { seller, page: pageParam } }),
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
    select: (data) => ({ rows: data.pages.flatMap((p) => p.results ?? []), pages: data.pages.length }),
  });
}

export const useSeller = (id: string) =>
  useQuery({ queryKey: ["seller", id], retry: false, queryFn: () => api<Seller>(`/api/listings/sellers/${id}/`, { auth: false }) });

export const useSellerListings = (id: string, enabled: boolean) =>
  sellerPages<Listing & { category?: { kind?: string; is_accommodation?: boolean } }>("seller-listings", "/api/listings/", id, enabled);

export const useSellerEvents = (id: string, enabled: boolean) => sellerPages<EventSummary>("seller-events", "/api/events/", id, enabled);

export const useEvent = (id: string) =>
  useQuery({ queryKey: ["event", id], queryFn: () => api<EventDetail>(`/api/events/${id}/`, { auth: false }) });

export type BookingTerms = {
  enabled: boolean;
  policies?: Record<string, { label: string; text: string; tiers: [number, number][] }>;
};
export const useBookingTerms = () =>
  useQuery({ queryKey: ["booking-terms"], staleTime: 5 * 60_000, queryFn: () => api<BookingTerms>("/api/ledger/booking-terms/", { auth: false }) });
