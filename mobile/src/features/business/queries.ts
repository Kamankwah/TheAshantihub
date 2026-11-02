import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";

export type Me = {
  id: number;
  full_name: string;
  kyc_status?: string;
  kyc_rejection_reason?: string;
  identity_status?: string;
  identity_rejection_reason?: string | null;
  registration_step?: string;
};
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
