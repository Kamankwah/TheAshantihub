import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
import type { Department, Listing, Page } from "./types";

export function useDepartments() {
  return useQuery({
    queryKey: ["departments"],
    queryFn: async () => (await api<{ most_visited: Department[] }>("/api/storefront/home/", { auth: false })).most_visited,
  });
}

/** Listings, 20 a page, newest-first unless `ordering` says otherwise. `category` is a department slug. */
export function useListings(params: { search?: string; category?: string; ordering?: string }) {
  return useInfiniteQuery({
    queryKey: ["listings", params],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api<Page<Listing>>("/api/listings/", { auth: false, query: { ...params, page: pageParam } }),
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
  });
}

type DealRow = {
  id: number; name: string; photo: string | null; category_label?: string; price_amount: string; sale_price: string | null;
  was_price: string | null; sponsored?: boolean; review_count?: number; avg_rating?: number | null;
  photo_variants?: { thumb: string | null; medium: string | null; large: string | null } | null;
};

/** The deals feed has its own row shape (no seller, one photo); make it a card. */
export function normalizeDeal(r: DealRow): Listing {
  return {
    id: r.id, name: r.name, price_amount: r.price_amount, effective_price: r.sale_price ?? r.price_amount, sale_price: r.sale_price,
    was_price: r.was_price, main_photo: r.photo, main_photo_variants: r.photo_variants ?? { thumb: r.photo, medium: r.photo, large: r.photo }, // thumb is 320 px when the server sends copies (MOB-15)
    avg_rating: r.avg_rating, review_count: r.review_count ?? 0, is_promoted: !!r.sponsored,
  };
}

export function useDeals() {
  return useQuery({
    queryKey: ["deals"],
    queryFn: async () => {
      const data = await api<DealRow[] | { results?: DealRow[] }>("/api/storefront/deals/", { auth: false, query: { limit: 12 } });
      return (Array.isArray(data) ? data : (data.results ?? [])).map(normalizeDeal);
    },
  });
}
