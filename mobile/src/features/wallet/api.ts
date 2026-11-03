import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { api, ApiError } from "../../lib/api";
import type { Page } from "../browse/types";
import { formatCedis } from "../../ui/Price";

// What /api/wallet/ answers (backend/wallets). Amounts arrive as strings in GH₵ ("1250.50").
export type CustomerWallet = { kind: "customer"; balance: string; held_topup_pesewas?: number; topup_free_at?: string | null };
export type VendorWallet = { kind: "vendor"; pending: string; available: string };
export type WalletSummary = CustomerWallet | VendorWallet;

export type Line = {
  id: number; at: string; account: string; kind: string; label: string; direction: "in" | "out"; amount: string;
  order: number | null; booking_sale: number | null; reference: string;
};
export type Destination = {
  id: number; rail: "momo" | "bank"; institution: string; account_number_masked: string; account_name: string; name_check?: string;
  usable_from: string; usable: boolean; removed: boolean; created_at?: string;
};
export type Withdrawal = {
  id: number; reference: string; amount: string; charge: string; you_receive: string; status: string; status_label: string;
  destination: Destination; created_at: string; settled_at: string | null; failure_reason: string;
};

export type VendorOverview = {
  pending: string; available: string; withdrawable: string; negative: boolean; awaiting_call: number; withdrawing: string;
  fee_cap: { limit: string | null; used: string; remaining: string | null };
};
export type SaleRow = {
  kind: "order" | "booking"; reference: string; placed_at: string; item_subtotal: string; refunded: string; platform_fee: string;
  free_delivery_promo: string; net: string; status: string; status_label: string; on_hold: boolean;
  items?: { name: string; quantity: number; line_total: string }[]; what?: string; booking_kind_label?: string;
};
export type DailyTotals = { orders: number; sold: string; fees: string; released: string; refunded: string; free_delivery_promo: string; withdrawn: string; other: string; net_change: string };
export type Daily = { from: string; to: string; days: (DailyTotals & { day: string })[]; totals: DailyTotals };
export type FeeBand = { from: string; to: string | null; percent: string | null; fee: string; flat?: string | null };
export type FeeSchedule = {
  categories: { category: string; label: string; applies_to: string; charged: boolean; in_force_from: string | null; bands: FeeBand[]; next: { from: string; bands: FeeBand[] } | null }[];
  fee_base: string; fee_cap: VendorOverview["fee_cap"];
};

/** Wallets answer 409 "ledger_off" while the ledger is switched off (it is, in production for now); a 404 means the same here. */
export function isWalletOff(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return err.status === 404 || (err.status === 409 && (err.code === "ledger_off" || (err.body as { code?: string } | undefined)?.code === "ledger_off"));
}

const retry = (count: number, err: unknown) => !isWalletOff(err) && count < 1;

export const useWallet = () =>
  useQuery({ queryKey: ["wallet"], queryFn: () => api<WalletSummary>("/api/wallet/"), retry });

export function useTransactions() {
  return useInfiniteQuery({
    queryKey: ["wallet", "transactions"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api<Page<Line>>("/api/wallet/transactions/", { query: { page: pageParam } }),
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
    retry,
  });
}

export const useDestinations = () =>
  useQuery({
    queryKey: ["wallet", "destinations"],
    queryFn: () => api<{ results: Destination[]; cooling_hours?: number }>("/api/wallet/destinations/"),
    retry,
  });

export function useWithdrawals() {
  return useInfiniteQuery({
    queryKey: ["wallet", "withdrawals"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api<Page<Withdrawal>>("/api/wallet/withdrawals/", { query: { page: pageParam } }),
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
    retry,
  });
}

export const useVendorOverview = () =>
  useQuery({ queryKey: ["wallet", "vendor"], queryFn: () => api<VendorOverview>("/api/wallet/vendor/"), retry });

export function useVendorList(kind: "sales" | "bookings", status: string) {
  return useInfiniteQuery({
    queryKey: ["wallet", "vendor", kind, status],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api<Page<SaleRow>>(`/api/wallet/vendor/${kind}/`, { query: { page: pageParam, status } }),
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
    retry,
  });
}

export const useVendorDaily = () =>
  useQuery({ queryKey: ["wallet", "vendor", "daily"], queryFn: () => api<Daily>("/api/wallet/vendor/daily/"), retry });

export const useVendorFees = () =>
  useQuery({ queryKey: ["wallet", "vendor", "fees"], queryFn: () => api<FeeSchedule>("/api/wallet/vendor/fees/"), retry });

/** Everything one paged list holds, flattened. */
export const flatPages = <T,>(data?: { pages: Page<T>[] }): T[] => (data?.pages ?? []).flatMap((p) => p.results);

/** The "Pay with AshantiHub wallet" option at checkout: enabled only when the server says the wallet works and covers the total. */
export function walletChoice(
  q: { data: WalletSummary | undefined; isPending: boolean; isError: boolean; error: unknown },
  total: number,
): { enabled: boolean; note: string } {
  if (q.isPending) return { enabled: false, note: "Checking your wallet…" };
  if (q.isError) {
    return isWalletOff(q.error) ? { enabled: false, note: "Not available yet" } : { enabled: false, note: "We couldn’t check your wallet" };
  }
  if (!q.data || q.data.kind !== "customer") return { enabled: false, note: "Not available yet" };
  const balance = Number(q.data.balance);
  if (!Number.isFinite(balance) || balance < total) return { enabled: false, note: `Balance too low (${formatCedis(balance || 0)})` };
  return { enabled: true, note: `Balance ${formatCedis(balance)}` };
}

/** A fresh id for a withdrawal. The server pays a repeated id once, so a retry is never paid twice; 8 to 64 characters. */
export function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 8)}`;
}

const AMOUNT = /^[0-9]+(\.[0-9]{1,2})?$/;
/** True when text is an amount in GH₵ the server will accept (digits with at most two decimals, more than zero). */
export function isAmount(text: string): boolean {
  const t = text.trim();
  return AMOUNT.test(t) && Number(t) > 0;
}

export function whenText(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function dayText(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}
