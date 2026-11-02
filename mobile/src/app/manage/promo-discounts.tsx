import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";

import { useListingDiscounts } from "../../features/business/promotions";
import { useMyListings } from "../../features/business/queries";
import { api } from "../../lib/api";
import { apiMessage } from "../../lib/errors";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { BackButton } from "../../ui/BackButton";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Field } from "../../ui/Field";
import { PickerRow } from "../../ui/PickerRow";
import { formatCedis } from "../../ui/Price";
import { Screen } from "../../ui/Screen";

/** Discounts: put a published product on sale at once, and end it any time. */
export default function PromoDiscounts() {
  const { c, radius } = useTheme();
  const qc = useQueryClient();
  const listings = useMyListings();
  const published = (listings.data ?? []).filter((l) => l.status === "published");
  const [id, setId] = useState<number | null>(null);
  const discounts = useListingDiscounts(id);
  const [percent, setPercent] = useState("");
  const [busy, setBusy] = useState<"start" | "end" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = discounts.data ?? [];
  const running = rows.find((r) => r.target === "listing");
  async function start() {
    setBusy("start");
    setError(null);
    try {
      await api(`/api/listings/mine/${id}/discounts/`, { body: { percent_off: Number(percent) } });
      setPercent("");
      await qc.invalidateQueries({ queryKey: ["listing-discounts", id] });
      await qc.invalidateQueries({ queryKey: ["owner-listings"] });
    } catch (e) {
      setError(apiMessage(e, "We couldn’t start the discount."));
    } finally {
      setBusy(null);
    }
  }
  async function end() {
    setBusy("end");
    setError(null);
    try {
      await api(`/api/listings/mine/${id}/discounts/end/`, { body: {} });
      await qc.invalidateQueries({ queryKey: ["listing-discounts", id] });
      await qc.invalidateQueries({ queryKey: ["owner-listings"] });
    } catch (e) {
      setError(apiMessage(e, "We couldn’t end the discount."));
    } finally {
      setBusy(null);
    }
  }
  const pct = Number(percent);
  return (
    <Screen>
      <BackButton fallback="/manage/promotions" />
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>Discounts</Text>
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>A discount goes live at once. Customers see the old price and the new one.</Text>
      {listings.isError ? <EmptyState title="We couldn’t load your listings" action={{ label: "Try again", onPress: () => void listings.refetch() }} /> : null}
      <PickerRow label="Listing" placeholder="Choose a published listing" value={id} onChange={setId} options={published.map((l) => ({ value: l.id, label: l.name }))} />
      {id != null && discounts.isError ? <EmptyState title="We couldn’t load this listing’s discounts" action={{ label: "Try again", onPress: () => void discounts.refetch() }} /> : null}
      {id != null && discounts.data ? (
        <View style={{ gap: 12 }}>
          {rows.map((r) => (
            <View key={`${r.target}-${r.variant ?? "x"}`} style={{ borderRadius: radius.card, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, padding: 16, gap: 4 }}>
              <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 15 }}>{r.label ? `Option: ${r.label}` : "Running now"}</Text>
              <Text style={{ color: c.price, fontFamily: fonts.bodySemi, fontSize: 15, fontVariant: ["tabular-nums"] }}>{`${formatCedis(r.sale_price)} instead of ${formatCedis(r.regular_price)}${r.percent_off != null ? ` (${r.percent_off}% off)` : ""}`}</Text>
              {r.ends_at ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{`Ends ${new Date(r.ends_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" })}`}</Text> : null}
            </View>
          ))}
          {running ? (
            <Button variant="destructive" label="End discount" onPress={() => void end()} loading={busy === "end"} />
          ) : (
            <View style={{ gap: 12 }}>
              <Field label="Percent off" value={percent} onChangeText={(v) => setPercent(v.replace(/\D/g, ""))} keyboardType="number-pad" helper="For example: 15 takes 15% off the price." />
              <Button label="Start discount" onPress={() => void start()} loading={busy === "start"} disabled={!(pct >= 1 && pct <= 99)} />
            </View>
          )}
        </View>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
    </Screen>
  );
}
