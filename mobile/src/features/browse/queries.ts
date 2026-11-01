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

export function useDeals() {
  return useQuery({
    queryKey: ["deals"],
    queryFn: async () => {
      const data = await api<Listing[] | Page<Listing>>("/api/storefront/deals/", { auth: false, query: { limit: 12 } });
      return Array.isArray(data) ? data : (data.results ?? []);
    },
  });
}
