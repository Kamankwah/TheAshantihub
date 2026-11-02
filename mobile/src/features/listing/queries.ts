import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { closedMessage, opensAtDate } from "../../lib/opening";
import { useAuth } from "../../state/auth";
import type { ListingDetail } from "./types";

export function useListing(id: string | number) {
  return useQuery({ queryKey: ["listing", String(id)], queryFn: () => api<ListingDetail>(`/api/listings/${id}/`, { auth: false }) });
}

type Opening = { gate_enabled?: boolean; is_open?: boolean; opens_at?: string };

/** The one buy-disabled rule: closed marketplace AND this account cannot buy. The message is the API's date. */
export function useCanBuy(): { canBuy: boolean; message: string | null } {
  const signedIn = useAuth((s) => s.status === "signedIn");
  const opening = useQuery({ queryKey: ["opening"], queryFn: () => api<Opening>("/api/storefront/opening/", { auth: false }), staleTime: 30_000 });
  const closed = !!opening.data && !!opening.data.gate_enabled && opening.data.is_open === false;
  const me = useQuery({
    queryKey: ["me", "can-buy"],
    queryFn: () => api<{ can_buy?: boolean }>("/api/accounts/me/"),
    enabled: closed && signedIn,
    staleTime: 60_000,
  });
  const canBuy = !closed || me.data?.can_buy === true;
  return { canBuy, message: canBuy ? null : closedMessage(opensAtDate(opening.data?.opens_at)) };
}

export type GuardBlock = { code?: string; detail?: string } | null;

/** The delivery limits for this listing: the server decides, the app shows its words. */
export function useCartGuard(id: string | number, enabled: boolean) {
  return useQuery({
    queryKey: ["cart-guard", String(id)],
    enabled,
    queryFn: () => api<{ listing?: { blocked?: GuardBlock } }>("/api/cart/guard/", { query: { listing: id } }),
  });
}

export async function addToCart(listingId: number, lines?: { variant: number; quantity: number }[]) {
  await api("/api/cart/items/", { body: lines ? { listing: listingId, lines } : { listing: listingId, quantity: 1 } });
}
