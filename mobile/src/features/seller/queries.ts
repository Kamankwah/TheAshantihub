import { useQuery } from "@tanstack/react-query";

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

async function allPages<T>(path: string, seller: string | number): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= 25; page += 1) {
    const data = await api<Paged<T>>(path, { auth: false, query: { seller, page } });
    rows.push(...(data.results ?? []));
    if (!data.next) break;
  }
  return rows;
}

export const useSeller = (id: string) =>
  useQuery({ queryKey: ["seller", id], retry: false, queryFn: () => api<Seller>(`/api/listings/sellers/${id}/`, { auth: false }) });

export const useSellerListings = (id: string, enabled: boolean) =>
  useQuery({ queryKey: ["seller-listings", id], enabled, queryFn: () => allPages<Listing & { category?: { kind?: string; is_accommodation?: boolean } }>("/api/listings/", id) });

export const useSellerEvents = (id: string, enabled: boolean) =>
  useQuery({ queryKey: ["seller-events", id], enabled, queryFn: () => allPages<EventSummary>("/api/events/", id) });

export const useEvent = (id: string) =>
  useQuery({ queryKey: ["event", id], queryFn: () => api<EventDetail>(`/api/events/${id}/`, { auth: false }) });

export type BookingTerms = {
  enabled: boolean;
  policies?: Record<string, { label: string; text: string; tiers: [number, number][] }>;
};
export const useBookingTerms = () =>
  useQuery({ queryKey: ["booking-terms"], staleTime: 5 * 60_000, queryFn: () => api<BookingTerms>("/api/ledger/booking-terms/", { auth: false }) });
