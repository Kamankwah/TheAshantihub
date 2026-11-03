import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { asArray } from "../../lib/asArray";
import type { Feather } from "@expo/vector-icons";
import { eventStart, validTime } from "./events";

export type DeliveryPromo = {
  id: number; name: string; starts_at: string; ends_at: string; all_items: boolean; listings: { id: number; name: string }[];
  status: string; effective_status: string; live: boolean; rejection_reason: string; covered_orders: number; covered_total: string;
  funded_by: "business" | "platform";
};
export type FlashInvitation = {
  sale_id: number; name: string; starts_at: string; ends_at: string; discount_pct: number | null; answer: string;
  listings: { id: number; name: string; normal_price: string; sale_price: string }[];
};
export type Discount = { target: "listing" | "variant"; variant: number | null; label: string | null; regular_price: string; sale_price: string; percent_off: number | null; ends_at: string | null };

export const useDeliveryPromos = () => useQuery({ queryKey: ["owner-delivery-promos"], queryFn: async () => ({ results: asArray<DeliveryPromo>(await api<unknown>("/api/marketing/owner/delivery-promos/")) }) });
export const useFlashInvitations = () => useQuery({ queryKey: ["owner-flash-invitations"], queryFn: async () => ({ results: asArray<FlashInvitation>(await api<unknown>("/api/marketing/owner/flash-sales/")) }) });
export const usePromotionPricing = () => useQuery({ queryKey: ["promotion-pricing"], queryFn: () => api<{ enabled: boolean }>("/api/listings/promotions/pricing/") });
export const useListingDiscounts = (listingId: number | null) =>
  useQuery({ queryKey: ["listing-discounts", listingId], enabled: listingId != null, queryFn: async () => asArray<Discount>(await api<unknown>(`/api/listings/mine/${listingId}/discounts/`)) });

type Meta = { tone: "success" | "warn" | "error" | "neutral"; icon: keyof typeof Feather.glyphMap; label: string };
export function promoStatus(p: Pick<DeliveryPromo, "effective_status" | "live">): Meta {
  switch (p.effective_status) {
    case "pending": return { tone: "warn", icon: "clock", label: "Waiting for review" };
    case "active": return { tone: "success", icon: "check-circle", label: p.live ? "Approved · running now" : "Approved" };
    case "paused": return { tone: "warn", icon: "pause-circle", label: "Paused" };
    case "ended": return { tone: "neutral", icon: "slash", label: "Ended" };
    case "rejected": return { tone: "error", icon: "alert-circle", label: "Not approved" };
    default: return { tone: "neutral", icon: "help-circle", label: p.effective_status };
  }
}

export type DeliveryPromoForm = { name: string; startDate: string; startTime: string; endDate: string; endTime: string; allItems: boolean; picked: number[] };

export function canSendDeliveryPromo(f: DeliveryPromoForm): boolean {
  if (!f.name.trim() || !validTime(f.startTime) || !validTime(f.endTime)) return false;
  const start = eventStart(f.startDate, f.startTime);
  const end = eventStart(f.endDate, f.endTime);
  if (!start || !end || end <= start) return false;
  return f.allItems || f.picked.length > 0;
}

/** Times are read as Accra time (UTC all year), like the web form. */
export function buildDeliveryPromoBody(f: DeliveryPromoForm) {
  return {
    name: f.name.trim(), starts_at: eventStart(f.startDate, f.startTime), ends_at: eventStart(f.endDate, f.endTime),
    all_items: f.allItems, listing_ids: f.allItems ? [] : f.picked,
  };
}

export const whenText = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" });
