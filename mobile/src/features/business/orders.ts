import { useInfiniteQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";

export type OwnerOrder = {
  id: number;
  customer_name?: string;
  status: string;
  delivery_status: string;
  placed_at: string;
  items: { id: number; listing_name: string; quantity: number; line_total?: string }[];
  owner_subtotal?: string;
  pickup_code?: string | null;
  pickup_status?: string | null;
  pickup_eta_late?: boolean;
  delivery_method?: string;
};

/** Only the first name ever reaches a business screen. */
export function firstName(full?: string | null): string {
  const first = (full ?? "").trim().split(/\s+/)[0];
  return first || "Customer";
}

export const toPrepare = (o: OwnerOrder) => o.status === "paid" && o.delivery_status === "processing";

export function useOwnerOrders() {
  return useInfiniteQuery({
    queryKey: ["owner-orders"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api<{ results: OwnerOrder[]; next: string | null }>("/api/orders/owner/", { query: { page: pageParam } }),
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
  });
}
