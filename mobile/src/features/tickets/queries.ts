import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { asArray } from "../../lib/asArray";
import type { Money } from "../bookings/terms";

export type TicketType = { id: number; name: string; description?: string; price: string; delivery_method: string; quantity_remaining: number | null };
export type Ticket = {
  id: number; code: string; price: string; delivery_method: string; escrow_status: string; delivered_at: string | null; refunded_at: string | null;
  ticket_type: { id: number; name: string }; event: { id: number; name: string; event_date: string | null }; money: Money | null;
};

export const useTicketTypes = (eventId: string, enabled: boolean) =>
  useQuery({ queryKey: ["ticket-types", eventId], enabled, queryFn: async () => asArray<TicketType>(await api<unknown>(`/api/events/${eventId}/ticket-types/`, { auth: false })) });

export const useMyTickets = () => useQuery({ queryKey: ["tickets", "mine"], queryFn: async () => asArray<Ticket>(await api<unknown>("/api/events/tickets/mine/")) });

/** The ticket's status in plain words: refunded first, then delivered, then the escrow state (the web's wording). */
export function ticketStatus(t: Pick<Ticket, "refunded_at" | "delivered_at" | "escrow_status">): string {
  if (t.refunded_at) return "Refunded";
  if (t.delivered_at) return "Delivered";
  if (t.escrow_status === "released") return "Released";
  return "Held";
}

/** One purchase is one sale: tickets that share a sale are shown together with one money panel. */
export function groupTicketsByPurchase(tickets: Ticket[]): { key: string; money: Money | null; tickets: Ticket[] }[] {
  const groups: { key: string; money: Money | null; tickets: Ticket[] }[] = [];
  const bySale = new Map<number, (typeof groups)[number]>();
  for (const t of tickets) {
    const sale = t.money?.sale;
    if (sale == null) groups.push({ key: `ticket-${t.id}`, money: t.money ?? null, tickets: [t] });
    else if (bySale.has(sale)) bySale.get(sale)!.tickets.push(t);
    else {
      const g = { key: `sale-${sale}`, money: t.money, tickets: [t] };
      bySale.set(sale, g);
      groups.push(g);
    }
  }
  return groups;
}
