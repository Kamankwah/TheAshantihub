import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { api } from "../../lib/api";
import { apiMessage } from "../../lib/errors";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Pill } from "../../ui/Pill";
import { formatCedis, Price } from "../../ui/Price";
import { Sheet } from "../../ui/Sheet";
import { Skeleton } from "../../ui/Skeleton";
import { flatPages, isAmount, isWalletOff, newRequestId, useDestinations, useWithdrawals, whenText, type Destination, type Withdrawal } from "./api";
import { CodeStep } from "./CodeStep";

const NETWORKS = ["MTN", "Telecel", "AirtelTigo"];
const stepUp = (token: string) => ({ headers: { "X-Step-Up-Token": token } });
const nameOf = (d: Destination) => `${d.institution} ${d.account_number_masked}`;

export function Notice({ text }: { text: string | null }) {
  const { c } = useTheme();
  if (!text) return null;
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ backgroundColor: c.well, borderRadius: 12, padding: 12 }}>
      <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14, lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

function Choice({ label, selected, disabled, onPress, children }: { label: string; selected: boolean; disabled?: boolean; onPress: () => void; children: React.ReactNode }) {
  const { c, radius } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 52, borderRadius: radius.control, borderWidth: selected ? 2 : 1, borderColor: selected ? c.ink : c.line, backgroundColor: c.surface, padding: 12, justifyContent: "center", opacity: disabled ? 0.5 : 1 }}
    >
      {children}
    </Pressable>
  );
}

/** Opens the withdraw sheet. Disabled until there is at least one payout account that can receive money. */
export function WithdrawButton({ onDone, blocked }: { onDone?: (text: string) => void; blocked?: boolean }) {
  const dest = useDestinations();
  const [open, setOpen] = useState(false);
  const usable = (dest.data?.results ?? []).filter((d) => d.usable);
  return (
    <>
      <Button variant="secondary" label="Withdraw" onPress={() => setOpen(true)} disabled={usable.length === 0 || !!blocked} />
      {open ? <WithdrawSheet destinations={usable} onClose={() => setOpen(false)} onDone={(t) => { setOpen(false); onDone?.(t); }} /> : null}
    </>
  );
}

function WithdrawSheet({ destinations, onClose, onDone }: { destinations: Destination[]; onClose: () => void; onDone: (text: string) => void }) {
  const { c } = useTheme();
  const qc = useQueryClient();
  const [stage, setStage] = useState<"form" | "code">("form");
  const [chosen, setChosen] = useState<number | null>(destinations.length === 1 ? destinations[0].id : null);
  const [amount, setAmount] = useState("");
  const ids = useRef<{ key: string; id: string } | null>(null);
  const ok = chosen !== null && isAmount(amount);

  async function submit(token: string) {
    const key = `${chosen}:${amount.trim()}`;
    if (!ids.current || ids.current.key !== key) ids.current = { key, id: newRequestId() };
    const w = await api<Withdrawal>("/api/wallet/withdrawals/", {
      body: { destination: chosen, amount: amount.trim(), request_id: ids.current.id },
      ...stepUp(token),
    });
    await qc.invalidateQueries({ queryKey: ["wallet"] });
    onDone(
      w.status === "failed"
        ? "The withdrawal didn’t go through. The money is back in your balance."
        : `Your withdrawal was sent. You receive ${formatCedis(w.you_receive)} after the withdrawal charge of ${formatCedis(w.charge)}.`,
    );
  }

  return (
    <Sheet visible onClose={onClose} title="Withdraw">
      {stage === "form" ? (
        <View style={{ gap: 12 }}>
          <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>Pay out to</Text>
          <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
            {destinations.map((d) => (
              <Choice key={d.id} label={nameOf(d)} selected={chosen === d.id} onPress={() => setChosen(d.id)}>
                <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>{`${d.institution} · ${d.account_number_masked}`}</Text>
                <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{d.account_name}</Text>
              </Choice>
            ))}
          </View>
          <Field label="Amount to withdraw (GH₵)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" helper="A small withdrawal charge is taken from this. You will see what you receive once it is sent." />
          <Button label="Continue" onPress={() => setStage("code")} disabled={!ok} />
        </View>
      ) : (
        <CodeStep action="withdrawal" onConfirmed={submit} onBack={() => setStage("form")} />
      )}
    </Sheet>
  );
}

function AddDestinationSheet({ onClose, onDone }: { onClose: () => void; onDone: (text: string) => void }) {
  const { c } = useTheme();
  const qc = useQueryClient();
  const [stage, setStage] = useState<"form" | "code">("form");
  const [rail, setRail] = useState<"momo" | "bank">("momo");
  const [network, setNetwork] = useState("MTN");
  const [bank, setBank] = useState("");
  const [number, setNumber] = useState("");
  const institution = rail === "momo" ? network : bank.trim();
  const ok = institution.length > 0 && number.replace(/\s/g, "").length >= 6;

  async function submit(token: string) {
    const d = await api<Destination>("/api/wallet/destinations/", {
      body: { rail, institution, account_number: number.trim() },
      ...stepUp(token),
    });
    await qc.invalidateQueries({ queryKey: ["wallet", "destinations"] });
    onDone(`Your payout account was added. You can withdraw to it from ${whenText(d.usable_from) || "the end of the safety wait"}.`);
  }

  return (
    <Sheet visible onClose={onClose} title="Add a payout account">
      {stage === "form" ? (
        <View style={{ gap: 12 }}>
          <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>
            Money you withdraw is paid here. The account name must match the name we have verified for you.
          </Text>
          <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Choice label="Mobile Money" selected={rail === "momo"} onPress={() => setRail("momo")}><Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14, textAlign: "center" }}>Mobile Money</Text></Choice></View>
            <View style={{ flex: 1 }}><Choice label="Bank account" selected={rail === "bank"} onPress={() => setRail("bank")}><Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14, textAlign: "center" }}>Bank account</Text></Choice></View>
          </View>
          {rail === "momo" ? (
            <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 8 }}>
              {NETWORKS.map((n) => (
                <View key={n} style={{ flex: 1 }}><Choice label={n} selected={network === n} onPress={() => setNetwork(n)}><Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14, textAlign: "center" }}>{n}</Text></Choice></View>
              ))}
            </View>
          ) : (
            <Field label="Bank name" value={bank} onChangeText={setBank} />
          )}
          <Field label={rail === "momo" ? "Mobile Money number" : "Bank account number"} value={number} onChangeText={setNumber} keyboardType="phone-pad" autoComplete="off" />
          <Button label="Continue" onPress={() => setStage("code")} disabled={!ok} />
        </View>
      ) : (
        <CodeStep action="payout_destination" onConfirmed={submit} onBack={() => setStage("form")} />
      )}
    </Sheet>
  );
}

function RemoveSheet({ destination, onClose, onDone }: { destination: Destination; onClose: () => void; onDone: (text: string) => void }) {
  const { c } = useTheme();
  const qc = useQueryClient();
  async function submit(token: string) {
    await api(`/api/wallet/destinations/${destination.id}/remove/`, { method: "POST", ...stepUp(token) });
    await qc.invalidateQueries({ queryKey: ["wallet", "destinations"] });
    onDone("The payout account was removed. A withdrawal already sent will still arrive.");
  }
  return (
    <Sheet visible onClose={onClose} title="Remove payout account">
      <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 15 }}>{`Stop paying to ${destination.institution} · ${destination.account_number_masked}?`}</Text>
      <CodeStep action="payout_destination" onConfirmed={submit} onBack={onClose} />
    </Sheet>
  );
}

/** The holder's payout accounts: where withdrawn money goes. Not payment methods: nothing is ever charged to them. */
export function DestinationsSection({ onNotice }: { onNotice?: (text: string) => void }) {
  const { c, radius } = useTheme();
  const q = useDestinations();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Destination | null>(null);
  const rows = q.data?.results ?? [];
  const done = (text: string) => { setAdding(false); setRemoving(null); onNotice?.(text); };
  return (
    <View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 20 }}>Payout accounts</Text>
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>Withdrawn money is paid to one of these. Nothing is ever taken from them.</Text>
      {q.isPending ? <Skeleton height={64} /> : null}
      {q.isError && !isWalletOff(q.error) ? <Button variant="secondary" label="Try again" onPress={() => void q.refetch()} /> : null}
      {q.data && rows.length === 0 ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 15 }}>You have no payout accounts yet.</Text> : null}
      {rows.map((d) => (
        <View key={d.id} style={{ backgroundColor: c.surface, borderRadius: radius.control, borderWidth: 1, borderColor: c.line, padding: 12, gap: 6 }}>
          <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>{`${d.institution} · ${d.account_number_masked}`}</Text>
          <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{d.account_name}</Text>
          {!d.usable ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{`Can receive money from ${whenText(d.usable_from)}`}</Text> : null}
          <Button variant="destructive" label={`Remove ${nameOf(d)}`} onPress={() => setRemoving(d)} />
        </View>
      ))}
      <Button variant="secondary" label="Add a payout account" onPress={() => setAdding(true)} />
      {adding ? <AddDestinationSheet onClose={() => setAdding(false)} onDone={done} /> : null}
      {removing ? <RemoveSheet destination={removing} onClose={() => setRemoving(null)} onDone={done} /> : null}
    </View>
  );
}

const TONE: Record<string, "success" | "warn" | "error" | "neutral"> = { succeeded: "success", pending: "warn", processing: "warn", failed: "error", cancelled: "neutral" };
const ICON: Record<string, "check" | "clock" | "x" | "minus"> = { succeeded: "check", pending: "clock", processing: "clock", failed: "x", cancelled: "minus" };

/** The holder's withdrawals, newest first, with what was charged and what arrived. A held one can be cancelled. */
export function WithdrawalsSection({ onNotice }: { onNotice?: (text: string) => void }) {
  const { c, radius } = useTheme();
  const qc = useQueryClient();
  const q = useWithdrawals();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = flatPages(q.data);

  async function cancel(w: Withdrawal) {
    setBusy(w.id);
    setError(null);
    try {
      await api(`/api/wallet/withdrawals/${w.id}/cancel/`, { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["wallet"] });
      onNotice?.("The withdrawal was cancelled. The money is back in your balance.");
    } catch (e) {
      setError(apiMessage(e, "We couldn’t cancel that withdrawal. It may already be on its way."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 20 }}>Withdrawals</Text>
      {q.isPending ? <Skeleton height={64} /> : null}
      {q.isError && !isWalletOff(q.error) ? <Button variant="secondary" label="Try again" onPress={() => void q.refetch()} /> : null}
      {q.data && rows.length === 0 ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 15 }}>No withdrawals yet.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
      {rows.map((w) => (
        <View key={w.id} style={{ backgroundColor: c.surface, borderRadius: radius.control, borderWidth: 1, borderColor: c.line, padding: 12, gap: 6 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Price amount={w.amount} />
            <Pill tone={TONE[w.status] ?? "neutral"} icon={ICON[w.status] ?? "clock"} label={w.status_label} />
          </View>
          <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{`${w.destination.institution} · ${w.destination.account_number_masked} · ${whenText(w.created_at)}`}</Text>
          <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 14 }}>{`Charge ${formatCedis(w.charge)}. You receive ${formatCedis(w.you_receive)}.`}</Text>
          {w.status === "failed" && w.failure_reason ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{w.failure_reason}</Text> : null}
          {w.status === "pending" ? <Button variant="secondary" label="Cancel withdrawal" onPress={() => void cancel(w)} loading={busy === w.id} /> : null}
        </View>
      ))}
      {q.hasNextPage ? <Button variant="secondary" label="Show more withdrawals" onPress={() => void q.fetchNextPage()} loading={q.isFetchingNextPage} /> : null}
    </View>
  );
}
