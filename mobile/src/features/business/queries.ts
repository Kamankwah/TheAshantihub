import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { asArray } from "../../lib/asArray";

export type Me = {
  id: number;
  full_name: string;
  kyc_status?: string;
  kyc_rejection_reason?: string;
  identity_status?: string;
  identity_rejection_reason?: string | null;
  registration_step?: string;
  /** Whether the shop can publish, and what still stops it. Only business owners get it. */
  go_live?: GoLive;
};
export type GoLive = { live: boolean; blockers: { code: string; message: string }[] };
export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/accounts/me/") });

export type StockRow = { listing_id: number; name: string; stock: number | null; days_of_cover: string | null; line: number | null; low: boolean; sold_out: boolean };
export type StockReport = { results: StockRow[]; settings?: { cover_days?: number; fallback_units?: number } };
export const useStock = () => useQuery({ queryKey: ["owner-stock"], queryFn: () => api<StockReport>("/api/catalogue/stock/") });

export const useHoursStatus = () =>
  useQuery({ queryKey: ["owner-hours"], queryFn: () => api<{ has_hours: boolean; days: import("../../lib/registrationApi").HoursDay[] }>("/api/accounts/business/hours/") });

export type OwnerListing = {
  id: number;
  name: string;
  description?: string;
  price_amount: string | null;
  status: string;
  stock_quantity: number | null;
  rejection_reason?: string;
  /** "We need to check this listing." while a pending listing is held; null otherwise. */
  hold_notice?: string | null;
  /** Plain sentences for a draft or rejected listing the last submit sent back. */
  fix_reasons?: string[];
  photos?: { id: number }[];
  main_photo?: string | null;
};
export const useMyListings = () =>
  useQuery({
    queryKey: ["owner-listings"],
    queryFn: async () => {
      const data = await api<OwnerListing[] | { results: OwnerListing[] }>("/api/listings/mine/");
      return Array.isArray(data) ? data : data.results;
    },
  });

import type { CategoryNode } from "./newListing";

/** The full category tree a business picks from (events are left out by the form). */
export const useCategoryTree = () =>
  useQuery({ queryKey: ["category-tree", "full"], staleTime: 10 * 60_000, queryFn: async () => asArray<CategoryNode>(await api<unknown>("/api/listings/categories/tree/", { query: { full: 1 } })) });

export const useZones = () =>
  useQuery({
    queryKey: ["zones"],
    staleTime: 10 * 60_000,
    queryFn: async () => asArray<{ id: number; name: string }>(await api<unknown>("/api/listings/zones/", { auth: false })),
  });

/** The kind of business ("product" or "service") this account registered as; null for older accounts (then both kinds are offered). */
export const useBusinessKind = () =>
  useQuery({
    queryKey: ["owner-business-kind"],
    staleTime: 10 * 60_000,
    queryFn: async () => (await api<{ business_kind?: string | null }>("/api/accounts/business-owners/me/profile/")).business_kind ?? null,
  });
