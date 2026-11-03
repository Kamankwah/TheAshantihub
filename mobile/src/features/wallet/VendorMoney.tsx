import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Pill } from "../../ui/Pill";
import { formatCedis, Price } from "../../ui/Price";
import { Skeleton } from "../../ui/Skeleton";
import { dayText, flatPages, isWalletOff, useVendorDaily, useVendorFees, useVendorList, type FeeBand, type SaleRow } from "./api";

export const TABS = ["Sales", "Bookings", "Days", "Fees", "Payouts"] as const;
export type Tab = (typeof TABS)[number];

/** A row of tabs that scroll sideways on a small phone. Text and a heavier border mark the chosen one, not colour alone. */
export function Segments<T extends string>({ items, value, onChange }: { items: readonly T[]; value: T; onChange: (v: T) => void }) {
  const { c, radius } = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {items.map((t) => (
        <Pressable
          key={t}
          accessibilityRole="tab"
          accessibilityLabel={t}
          accessibilityState={{ selected: value === t }}
          onPress={() => onChange(t)}
          style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: "center", borderRadius: radius.pill, borderWidth: value === t ? 2 : 1, borderColor: value === t ? c.ink : c.line, backgroundColor: c.surface }}
        >
          <Text style={{ color: c.ink, fontFamily: value === t ? fonts.bodyBold : fonts.body, fontSize: 14 }}>{t}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const STATUS_FILTERS = [["All", "all"], ["Waiting", "awaiting_call"], ["Released", "released"], ["Refunded", "refunded"]] as const;
const TONE: Record<string, "success" | "warn" | "error" | "neutral"> = { released: "success", awaiting_call: "warn", refunded: "neutral" };
const ICON: Record<string, "check" | "clock" | "rotate-ccw"> = { released: "check", awaiting_call: "clock", refunded: "rotate-ccw" };

function SaleCard({ s }: { s: SaleRow }) {
  const { c, radius } = useTheme();
  const what = s.kind === "order" ? (s.items ?? []).map((i) => `${i.quantity} × ${i.name}`).join(", ") : [s.booking_kind_label, s.what].filter(Boolean).join(": ");
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: radius.control, borderWidth: 1, borderColor: c.line, padding: 12, gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 15 }}>{s.reference}</Text>
        <Price amount={s.item_subtotal} />
      </View>
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{dayText(s.placed_at)}</Text>
      {what ? <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 14 }}>{what}</Text> : null}
      <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 14 }}>{`Fee ${formatCedis(s.platform_fee)} · You keep ${formatCedis(s.net)}`}</Text>
      {Number(s.refunded) > 0 ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{`Refunded ${formatCedis(s.refunded)}`}</Text> : null}
      {Number(s.free_delivery_promo) > 0 ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{`Free-delivery promo ${formatCedis(s.free_delivery_promo)}`}</Text> : null}
      <Pill tone={TONE[s.status] ?? "neutral"} icon={ICON[s.status] ?? "clock"} label={s.status_label} />
    </View>
  );
}

/** Orders or booking sales, 20 at a time, filtered by what happened to the money. Never a customer's name or contact. */
export function SalesList({ kind }: { kind: "sales" | "bookings" }) {
  const { c } = useTheme();
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number][1]>("all");
  const q = useVendorList(kind, status);
  const rows = flatPages(q.data);
  return (
    <View style={{ gap: 10 }}>
      <Segments items={STATUS_FILTERS.map((f) => f[0])} value={STATUS_FILTERS.find((f) => f[1] === status)![0]} onChange={(label) => setStatus(STATUS_FILTERS.find((f) => f[0] === label)![1])} />
      {q.isPending ? <Skeleton height={96} /> : null}
      {q.isError && !isWalletOff(q.error) ? <Button variant="secondary" label="Try again" onPress={() => void q.refetch()} /> : null}
      {q.data && rows.length === 0 ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 15 }}>{kind === "sales" ? "No orders here yet." : "No bookings here yet."}</Text> : null}
      {rows.map((s) => <SaleCard key={`${s.kind}-${s.reference}`} s={s} />)}
      {q.hasNextPage ? <Button variant="secondary" label="Show more" onPress={() => void q.fetchNextPage()} loading={q.isFetchingNextPage} /> : null}
    </View>
  );
}

/** Your money day by day for the last 30 days: sold, platform fees, released to Available, refunded and withdrawn. */
export function DaysList() {
  const { c, radius } = useTheme();
  const q = useVendorDaily();
  if (q.isPending) return <Skeleton height={96} />;
  if (q.isError) return isWalletOff(q.error) ? null : <Button variant="secondary" label="Try again" onPress={() => void q.refetch()} />;
  const t = q.data.totals;
  const line = (r: typeof t) => `Sold ${formatCedis(r.sold)} · Fees ${formatCedis(r.fees)} · Released ${formatCedis(r.released)} · Refunded ${formatCedis(r.refunded)} · Withdrawn ${formatCedis(r.withdrawn)}`;
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{`${dayText(q.data.from)} to ${dayText(q.data.to)}`}</Text>
      {q.data.days.length === 0 ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 15 }}>No money moved in this time.</Text> : null}
      {q.data.days.length > 0 ? (
        <View style={{ backgroundColor: c.well, borderRadius: radius.control, padding: 12, gap: 4 }}>
          <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 15 }}>Total</Text>
          <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>{line(t)}</Text>
        </View>
      ) : null}
      {q.data.days.map((d) => (
        <View key={d.day} style={{ backgroundColor: c.surface, borderRadius: radius.control, borderWidth: 1, borderColor: c.line, padding: 12, gap: 4 }}>
          <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 15 }}>{dayText(d.day)}</Text>
          <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>{line(d)}</Text>
          <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{`${d.orders} ${d.orders === 1 ? "sale" : "sales"} paid`}</Text>
        </View>
      ))}
    </View>
  );
}

const bandText = (b: FeeBand) => `${formatCedis(b.from)} ${b.to ? `to ${formatCedis(b.to)}` : "and above"}: ${b.fee}`;

/** The platform fees in force for each kind of sale, and how a fee is worked out. */
export function FeesList() {
  const { c, radius } = useTheme();
  const q = useVendorFees();
  if (q.isPending) return <Skeleton height={96} />;
  if (q.isError) return isWalletOff(q.error) ? null : <Button variant="secondary" label="Try again" onPress={() => void q.refetch()} />;
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 14, lineHeight: 21 }}>{q.data.fee_base}</Text>
      {q.data.categories.map((cat) => (
        <View key={cat.category} style={{ backgroundColor: c.surface, borderRadius: radius.control, borderWidth: 1, borderColor: c.line, padding: 12, gap: 4 }}>
          <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 15 }}>{cat.applies_to}</Text>
          {!cat.charged ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>No fee is taken on these right now.</Text> : null}
          {cat.bands.map((b) => <Text key={b.from} style={{ color: c.ink, fontFamily: fonts.body, fontSize: 14 }}>{bandText(b)}</Text>)}
          {cat.next ? (
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 }}>
              {`From ${dayText(cat.next.from)}: ${cat.next.bands.map(bandText).join("; ")}. It applies only to orders paid after then.`}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
