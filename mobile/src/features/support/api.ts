import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";

export type SupportMessage = { id: number; sender_type: "customer" | "business_owner" | "staff"; body: string; created_at: string };
export type Conversation = { id: number; subject: string; status: string; updated_at: string; messages: SupportMessage[] };

/** The caller's own conversations, full threads. Polled every 15 s while a screen using it is open. */
export const useConversations = (poll = false) =>
  useQuery({
    queryKey: ["conversations"],
    queryFn: () => api<Conversation[]>("/api/messaging/conversations/"),
    refetchInterval: poll ? 60_000 : false, // the messaging API allows 60 requests an hour
  });

export function sourceFor(about: { order?: string; listing?: string }, accountType: "customer" | "business_owner"): string {
  if (about.order) return "order_page";
  if (about.listing) return "listing_page";
  return accountType === "business_owner" ? "business_dashboard" : "app";
}

export type StartAbout = { about?: string; listing?: string; business?: string; order?: string };

/** Every "Contact Support" button ends here: a conversation with AshantiHub Support, never with the business. */
export async function startSupport(about: StartAbout, body: string, accountType: "customer" | "business_owner"): Promise<Conversation> {
  return api<Conversation>("/api/messaging/conversations/", {
    body: {
      subject: about.about ?? "",
      body,
      ...(about.listing ? { about_listing: Number(about.listing) } : {}),
      ...(about.business ? { about_business: Number(about.business) } : {}),
      ...(about.order ? { about_order: Number(about.order) } : {}),
      source: sourceFor(about, accountType),
    },
  });
}

export const sendReply = (id: number, body: string) => api(`/api/messaging/conversations/${id}/messages/`, { body: { body } });

export function lastMessage(c: Conversation): SupportMessage | undefined {
  return c.messages[c.messages.length - 1];
}
