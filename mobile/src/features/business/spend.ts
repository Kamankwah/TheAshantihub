import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { asArray } from "../../lib/asArray";

export type Payment = { id?: number; amount?: string; created_at?: string; status?: string; purpose?: string };
export type SpendMonth = { key: string; month: string; amount: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The last six months of what the owner paid AshantiHub (subscriptions and promotions), from successful payments only,
 * bucketed by month. It is spend, not sales: an owner has no payment row for what customers bought.
 */
export function buildSpendSeries(payments: Payment[] | null | undefined, now: Date = new Date()): SpendMonth[] {
  const buckets: SpendMonth[] = [];
  const index: Record<string, SpendMonth> = {};
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const row = { key, month: MONTHS[d.getUTCMonth()], amount: 0 };
    buckets.push(row);
    index[key] = row;
  }
  for (const p of payments ?? []) {
    if (!p || p.status !== "success" || !p.created_at) continue;
    const row = index[String(p.created_at).slice(0, 7)];
    const amount = Number(p.amount);
    if (row && Number.isFinite(amount)) row.amount += amount;
  }
  return buckets;
}

export const useSpend = () =>
  useQuery({ queryKey: ["owner-spend"], queryFn: async () => asArray<Payment>(await api<unknown>("/api/billing/transactions/mine/")) });
