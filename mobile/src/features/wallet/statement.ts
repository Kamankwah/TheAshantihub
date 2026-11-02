import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { api } from "../../lib/api";

export type Preset = "30" | "90" | "365";
export const PRESETS: { key: Preset; label: string }[] = [
  { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" },
  { key: "365", label: "Last 12 months" },
];

const day = (d: Date) => d.toISOString().slice(0, 10);
/** The statement's date range, ending today (Accra time is UTC). The server accepts at most 366 days. */
export function rangeFor(preset: Preset, now: Date = new Date()): { date_from: string; date_to: string } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - Number(preset)));
  return { date_from: day(from), date_to: day(now) };
}

export class CannotShare extends Error {}

/** Fetch the statement CSV, save it in the app's cache and open the phone's share sheet (save to Files, WhatsApp, email). */
export async function exportStatement(preset: Preset): Promise<void> {
  const range = rangeFor(preset);
  const csv = await api<string>("/api/wallet/vendor/statement/export/", { query: range });
  if (!(await Sharing.isAvailableAsync())) throw new CannotShare("This phone can’t share files from the app.");
  const file = new File(Paths.cache, `ashantihub-statement-${range.date_from}-to-${range.date_to}.csv`);
  file.create({ overwrite: true });
  file.write(typeof csv === "string" ? csv : "");
  await Sharing.shareAsync(file.uri, { mimeType: "text/csv", UTI: "public.comma-separated-values-text", dialogTitle: "AshantiHub statement" });
}
