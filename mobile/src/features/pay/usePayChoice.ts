import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../../lib/api";
import { formatCedis } from "../../ui/Price";
import { isWalletOff } from "../wallet/api";

export type PayMethod = "momo" | "wallet";
type Quote = { amount: string; payment_processing: string; you_pay: string };

export type PayChoiceState = {
  /** "on": the ledger works; "off": it is switched off (or does not apply); "unknown": we could not tell. */
  state: "on" | "off" | "unknown";
  method: PayMethod;
  setMethod: (m: PayMethod) => void;
  wallet: { enabled: boolean; note: string };
  /** The payment-processing charge Mobile Money adds, as the server quoted it (GH₵ "1.50"). */
  processing?: string;
  /** What leaves the person's phone or wallet: the amount, plus the processing charge for Mobile Money. */
  youPay?: string;
  /** False until the choice can be paid honestly: the wallet question and the charge quote are answered. */
  ready: boolean;
  problem: string | null;
  /** Merge into the POST body: nothing while the ledger is off (the request stays as it always was). */
  body: { payment_method?: PayMethod };
};

/**
 * How a booking (stay, service or ticket) is paid. The wallet is offered only when the server says it works and the
 * balance covers `amount`; every other state says why in plain words. `inLedger` is false for tickets to an event
 * organised by a customer: those take Mobile Money only.
 */
export function usePayChoice({ amount, inLedger = true, enabled = true }: { amount: string | number; inLedger?: boolean; enabled?: boolean }): PayChoiceState {
  const active = enabled && inLedger;
  const walletQuery = useQuery({ ...walletOptions(), enabled: active });
  const [chosen, setMethod] = useState<PayMethod>("momo");

  let state: PayChoiceState["state"] = "unknown";
  let problem: string | null = null;
  if (!active) state = "off";
  else if (walletQuery.data) state = "on";
  else if (walletQuery.isError) {
    if (isWalletOff(walletQuery.error)) state = "off";
    else problem = "We couldn’t check your wallet. Try again.";
  }

  const total = Number(amount);
  let wallet: PayChoiceState["wallet"];
  if (!inLedger) wallet = { enabled: false, note: "This event takes Mobile Money only" };
  else if (state === "off") wallet = { enabled: false, note: "Not available yet" };
  else if (state === "unknown") wallet = { enabled: false, note: walletQuery.isError ? "We couldn’t check your wallet" : "Checking your wallet…" };
  else if (!walletQuery.data || walletQuery.data.kind !== "customer") wallet = { enabled: false, note: "Not available yet" };
  else {
    const balance = Number(walletQuery.data.balance);
    wallet = !Number.isFinite(balance) || balance < total
      ? { enabled: false, note: `Balance too low (${formatCedis(balance || 0)})` }
      : { enabled: true, note: `Balance ${formatCedis(balance)}` };
  }

  const method: PayMethod = chosen === "wallet" && wallet.enabled ? "wallet" : "momo";
  const ledgerOn = state === "on";
  const typed = String(amount);
  const quote = useQuery({
    queryKey: ["wallet", "processing", typed],
    enabled: ledgerOn && method === "momo" && total > 0,
    retry: false,
    queryFn: () => api<Quote>("/api/wallet/processing/", { query: { amount: typed } }),
  });
  if (ledgerOn && method === "momo" && quote.isError && !problem) problem = "We couldn’t work out the payment-processing charge. Try again.";

  const processing = ledgerOn && method === "momo" ? quote.data?.payment_processing : undefined;
  const youPay = ledgerOn ? (method === "wallet" ? Number(total).toFixed(2) : quote.data?.you_pay) : undefined;
  const ready = state === "off" || (ledgerOn && (method === "wallet" || processing !== undefined));

  return {
    state, method, setMethod, wallet, processing, youPay, ready, problem,
    body: ledgerOn ? { payment_method: method } : {},
  };
}

function walletOptions() {
  return {
    queryKey: ["wallet"] as const,
    queryFn: () => api<import("../wallet/api").WalletSummary>("/api/wallet/"),
    retry: (count: number, err: unknown) => !isWalletOff(err) && count < 1,
  };
}
