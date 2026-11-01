import type { Feather } from "@expo/vector-icons";

export type StatusMeta = { tone: "success" | "warn" | "error" | "neutral"; icon: keyof typeof Feather.glyphMap; label: string };

const META: Record<string, StatusMeta> = {
  published: { tone: "success", icon: "check-circle", label: "Live" },
  pending_review: { tone: "warn", icon: "clock", label: "Waiting for review" },
  rejected: { tone: "error", icon: "alert-circle", label: "Needs changes" },
  draft: { tone: "neutral", icon: "edit-3", label: "Draft" },
  dropped: { tone: "neutral", icon: "eye-off", label: "Hidden" },
  discontinued: { tone: "neutral", icon: "slash", label: "Discontinued" },
};
export const listingStatus = (s: string): StatusMeta => META[s] ?? { tone: "neutral", icon: "help-circle", label: s };

export const FILTERS: { key: string; label: string; statuses: string[] }[] = [
  { key: "all", label: "All", statuses: [] },
  { key: "live", label: "Live", statuses: ["published"] },
  { key: "waiting", label: "Waiting", statuses: ["pending_review"] },
  { key: "changes", label: "Needs changes", statuses: ["rejected"] },
  { key: "drafts", label: "Drafts", statuses: ["draft"] },
  { key: "hidden", label: "Hidden", statuses: ["dropped"] },
];
