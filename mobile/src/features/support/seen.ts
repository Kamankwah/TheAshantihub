import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

import type { Conversation } from "./api";
import { lastMessage } from "./api";

const KEY = "support_seen_v1";

type SeenState = {
  seen: Record<string, number>;
  load: () => Promise<void>;
  markSeen: (c: Conversation) => void;
};

/** Which support replies this phone has opened (message id per conversation). Only used for the unread dot. */
export const useSeen = create<SeenState>((set, get) => ({
  seen: {},
  async load() {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (raw) set({ seen: { ...JSON.parse(raw), ...get().seen } });
    } catch {
      // an unreadable store just means every reply shows as new once
    }
  },
  markSeen(c) {
    const last = lastMessage(c);
    if (!last || (get().seen[String(c.id)] ?? 0) >= last.id) return;
    const seen = { ...get().seen, [String(c.id)]: last.id };
    set({ seen });
    void SecureStore.setItemAsync(KEY, JSON.stringify(seen)).catch(() => {});
  },
}));

/** Unread = Support spoke last and that message has not been opened here. */
export function isUnread(c: Conversation, seen: Record<string, number>): boolean {
  const last = lastMessage(c);
  return !!last && last.sender_type === "staff" && last.id > (seen[String(c.id)] ?? 0);
}
