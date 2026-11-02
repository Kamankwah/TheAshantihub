import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { asArray } from "../../lib/asArray";
import type { Feather } from "@expo/vector-icons";

export type OwnerEvent = {
  id: number; name: string; description: string; address: string; event_date: string | null; visibility_days: number;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled"; rejection_reason: string; access_level: "public" | "private";
  access_code?: string; paid_at: string | null; expires_at: string | null; going_count?: number; refund_until_days_before: number | null;
  cancelled_at: string | null; cancel_reason: string;
};
export type PricingTier = { id: number; duration_days: number; live_price: string };
export type OwnerTicketType = {
  id: number; name: string; description: string; price: string; delivery_method: "digital" | "physical"; quantity_total: number | null;
  quantity_sold: number; quantity_remaining: number | null; is_active: boolean;
};

export const useMyEvents = () => useQuery({ queryKey: ["owner-events"], queryFn: async () => asArray<OwnerEvent>(await api<unknown>("/api/events/mine/")) });
export const usePricingTiers = () => useQuery({ queryKey: ["event-pricing-tiers"], staleTime: 10 * 60_000, queryFn: async () => asArray<PricingTier>(await api<unknown>("/api/events/pricing-tiers/", { auth: false })) });
export const useOwnerTicketTypes = (eventId: string) =>
  useQuery({ queryKey: ["owner-ticket-types", eventId], queryFn: async () => asArray<OwnerTicketType>(await api<unknown>(`/api/events/${eventId}/ticket-types/mine/`)) });

export type EventForm = {
  category: number | null; zone: number | null; name: string; description: string; address: string;
  date: string; time: string; visibilityDays: number | null; access: "public" | "private"; refundDays: string;
};
export const emptyEventForm = (): EventForm => ({
  category: null, zone: null, name: "", description: "", address: "", date: "", time: "18:00", visibilityDays: null, access: "public", refundDays: "",
});

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const validTime = (t: string) => TIME.test(t.trim());

/** Accra time is UTC all year, so the start is the typed date and time read as UTC. */
export function eventStart(date: string, time: string): string | null {
  if (!date || !validTime(time)) return null;
  return `${date}T${time.trim()}:00Z`;
}

export function canSubmitEvent(f: EventForm): boolean {
  return f.category != null && f.zone != null && !!f.name.trim() && !!f.description.trim() && !!f.address.trim() && eventStart(f.date, f.time) !== null && f.visibilityDays != null;
}

export function buildEventBody(f: EventForm): Record<string, unknown> {
  return {
    category: f.category, zone: f.zone, name: f.name.trim(), description: f.description.trim(), address: f.address.trim(),
    event_date: eventStart(f.date, f.time), visibility_days: f.visibilityDays, access_level: f.access,
    refund_until_days_before: f.refundDays.trim() === "" ? null : Number(f.refundDays),
  };
}

export type EventStatus = { tone: "success" | "warn" | "error" | "neutral"; icon: keyof typeof Feather.glyphMap; label: string };
export function eventStatus(e: Pick<OwnerEvent, "status" | "paid_at">): EventStatus {
  if (e.status === "approved") return e.paid_at ? { tone: "success", icon: "check-circle", label: "Live" } : { tone: "warn", icon: "credit-card", label: "Approved, waiting for your payment" };
  if (e.status === "pending") return { tone: "warn", icon: "clock", label: "Waiting for review" };
  if (e.status === "rejected") return { tone: "error", icon: "alert-circle", label: "Needs changes" };
  if (e.status === "cancelled") return { tone: "error", icon: "x-circle", label: "Cancelled" };
  return { tone: "neutral", icon: "slash", label: "Ended" };
}
