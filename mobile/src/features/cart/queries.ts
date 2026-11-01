import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";

export type CartLine = {
  id: number;
  listing: number;
  listing_name: string;
  variant_label: string;
  quantity: number;
  unit_price_snapshot: string;
  line_total: string;
  seller_name?: string;
  in_stock?: boolean;
  stock_quantity?: number | null;
};
export type Cart = { id: number; total: string; items: CartLine[] };

export type DeliveryQuote = {
  fee: string | null;
  fee_status?: string;
  waived?: boolean;
  waiver_name?: string | null;
  waived_fee?: string | null;
  message?: string | null;
};

export const useCart = () => useQuery({ queryKey: ["cart"], queryFn: () => api<Cart>("/api/cart/") });

export const setLineQuantity = (id: number, quantity: number) => api(`/api/cart/items/${id}/`, { method: "PATCH", body: { quantity } });
export const removeLine = (id: number) => api(`/api/cart/items/${id}/`, { method: "DELETE" });

/** The fee checkout will add for door-to-door at a pinned point; null for pickup, fees off, or no point yet. */
export function useDeliveryPreview(enabled: boolean, lat?: number, lng?: number) {
  return useQuery({
    queryKey: ["delivery-preview", lat ?? null, lng ?? null],
    enabled,
    queryFn: () =>
      api<{ delivery: DeliveryQuote | null }>("/api/orders/delivery-preview/", { query: { fulfilment: "door_to_door", lat, lng } }),
  });
}
