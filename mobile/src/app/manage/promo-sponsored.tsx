import { router } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";

import { usePromotionPricing } from "../../features/business/promotions";
import { useMyListings } from "../../features/business/queries";
import { api } from "../../lib/api";
import { apiMessage } from "../../lib/errors";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { BackButton } from "../../ui/BackButton";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { ChoiceRow, PickerRow } from "../../ui/PickerRow";
import { Screen } from "../../ui/Screen";
import { Skeleton } from "../../ui/Skeleton";

/** Sponsored ads: ask for a listing to be featured (always first) or boosted (first for chosen searches). Our team approves each one. */
export default function PromoSponsored() {
  const { c } = useTheme();
  const pricing = usePromotionPricing();
  const listings = useMyListings();
  const published = (listings.data ?? []).filter((l) => l.status === "published");
  const [id, setId] = useState<number | null>(null);
  const [kind, setKind] = useState<"featured" | "boost">("featured");
  const [days, setDays] = useState("7");
  const [keywords, setKeywords] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const n = Number(days);
  const ready = id != null && n >= 1 && (kind === "featured" || keywords.trim() !== "");
  async function request() {
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      await api(`/api/listings/${id}/promote/`, { body: { kind, days: n, ...(kind === "boost" ? { keywords: keywords.trim() } : {}) } });
      setSent(true);
    } catch (e) {
      setError(apiMessage(e, "We couldn’t send this request. The listing may already have one waiting or running."));
    } finally {
      setBusy(false);
    }
  }
  const dim = { color: c.dim, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 } as const;
  return (
    <Screen>
      <BackButton fallback="/manage/promotions" />
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>Sponsored ad</Text>
      {pricing.isLoading ? <Skeleton height={80} /> : null}
      {pricing.data?.enabled ? (
        <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 22 }}>Sponsored ads are no longer free. Request one on the AshantiHub website, where the price is shown before you pay.</Text>
      ) : pricing.data ? (
        <>
          <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>Free for now. Prices will be announced before any charge.</Text>
          <PickerRow label="Listing" placeholder="Choose a published listing" value={id} onChange={setId} options={published.map((l) => ({ value: l.id, label: l.name }))} />
          <ChoiceRow label="Type" value={kind} onChange={setKind} options={[{ value: "featured", label: "Featured" }, { value: "boost", label: "Boost" }]} />
          <Text style={dim}>{kind === "featured" ? "Featured: your listing is shown first in every search." : "Boost: your listing is shown first for the searches you name."}</Text>
          <Field label="Days" value={days} onChangeText={(v) => setDays(v.replace(/\D/g, ""))} keyboardType="number-pad" />
          {kind === "boost" ? <Field label="Keywords" value={keywords} onChangeText={setKeywords} placeholder="e.g. kente, wedding" /> : null}
          <Text style={dim}>Our team checks every request before it goes live. Your listing starts ranking higher once it is approved.</Text>
          {sent ? <Text accessibilityLiveRegion="polite" style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>Sent for review. It costs nothing for now and goes live once our team approves it.</Text> : null}
          {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
          <Button label="Request this ad" onPress={() => void request()} loading={busy} disabled={!ready || busy} />
        </>
      ) : null}
      <Text style={dim}>To stop an ad early, contact Support. Stopping an ad early is not a refund: it ends the boost, and anything paid stays paid.</Text>
      <Button variant="secondary" label="Contact Support" onPress={() => router.push({ pathname: "/support/new", params: { about: "My sponsored ad" } } as never)} />
    </Screen>
  );
}
