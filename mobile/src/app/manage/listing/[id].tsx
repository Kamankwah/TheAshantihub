import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { listingStatus } from "../../../features/business/listingStatus";
import { useMyListings } from "../../../features/business/queries";
import { api } from "../../../lib/api";
import { apiMessage } from "../../../lib/errors";
import { fonts } from "../../../theme/fonts";
import { useTheme } from "../../../theme/useTheme";
import { Button } from "../../../ui/Button";
import { EmptyState } from "../../../ui/EmptyState";
import { Field } from "../../../ui/Field";
import { Pill } from "../../../ui/Pill";
import { Screen } from "../../../ui/Screen";
import { Skeleton } from "../../../ui/Skeleton";

/** Manage one listing: restock a live one, edit a draft, send for review, hide or show again, add photos. */
export default function ListingManage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const qc = useQueryClient();
  const list = useMyListings();
  const l = list.data?.find((x) => String(x.id) === String(id));
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [add, setAdd] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!l) return;
    setName(l.name);
    setPrice(l.price_amount ?? "");
    setStock(l.stock_quantity == null ? "" : String(l.stock_quantity));
  }, [l?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/business/listings" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
      <Feather name="arrow-left" size={24} color={c.ink} />
    </Pressable>
  );
  if (!l) {
    return <Screen>{back}{list.isPending ? <Skeleton height={160} /> : <EmptyState title="We couldn’t find this listing" action={{ label: "Try again", onPress: () => void list.refetch() }} />}</Screen>;
  }

  const s = listingStatus(l.status);
  const editable = l.status === "draft" || l.status === "rejected";

  async function run(key: string, work: () => Promise<unknown>, done: string, fail: string) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await work();
      setNote(done);
      await qc.invalidateQueries({ queryKey: ["owner-listings"] });
      await qc.invalidateQueries({ queryKey: ["owner-stock"] });
    } catch (e) {
      setError(apiMessage(e, fail));
    } finally {
      setBusy(null);
    }
  }

  async function addPhoto() {
    setError(null);
    let a: ImagePicker.ImagePickerAsset | undefined;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError("Allow photo access in your phone’s settings to add pictures.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
      if (result.canceled || !result.assets[0]) return;
      a = result.assets[0];
    } catch {
      setError("We couldn’t open your photos. Try again, or restart the app.");
      return;
    }
    const form = new FormData();
    form.append("image", { uri: a.uri, name: a.fileName ?? "photo.jpg", type: a.mimeType ?? "image/jpeg" } as never);
    await run("photo", () => api(`/api/listings/mine/${l!.id}/photos/`, { method: "POST", body: form }), "Photo added.", "We couldn’t add that photo. Try a smaller picture.");
  }

  return (
    <Screen>
      {back}
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 26 }}>{l.name}</Text>
      <Pill tone={s.tone} icon={s.icon} label={s.label} />
      {l.status === "rejected" && l.rejection_reason ? (
        <View accessibilityRole="alert" style={{ backgroundColor: c.well, borderRadius: 12, padding: 14, gap: 4 }}>
          <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 14 }}>What to fix</Text>
          <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>{l.rejection_reason}</Text>
        </View>
      ) : null}

      {l.status === "pending_review" && l.hold_notice ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>{l.hold_notice}</Text> : null}
      {editable && l.fix_reasons && l.fix_reasons.length > 0 ? (
        <View accessibilityRole="alert" style={{ backgroundColor: c.well, borderRadius: 12, padding: 14, gap: 4 }}>
          <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 14 }}>To fix before you submit again</Text>
          {l.fix_reasons.map((reason, i) => (
            <Text key={i} style={{ color: c.ink, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>{`• ${reason}`}</Text>
          ))}
        </View>
      ) : null}

      {editable ? (
        <View style={{ gap: 14 }}>
          <Field label="Name" value={name} onChangeText={setName} />
          <Field label="Price in GH₵" value={price} onChangeText={(v) => setPrice(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" />
          <Field label="Number in stock (leave empty if you don’t count)" value={stock} onChangeText={(v) => setStock(v.replace(/\D/g, ""))} keyboardType="number-pad" />
          <Button
            label="Save changes"
            loading={busy === "save"}
            disabled={name.trim().length === 0}
            onPress={() =>
              void run("save", () => api(`/api/listings/mine/${l.id}/`, { method: "PATCH", body: { name: name.trim(), price_amount: price, ...(stock !== "" ? { stock_quantity: Number(stock) } : {}) } }), "Saved.", "We couldn’t save your changes.")
            }
          />
          <Button variant="secondary" label="Add a photo" onPress={() => void addPhoto()} loading={busy === "photo"} />
          <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{`${l.photos?.length ?? 0} photos so far`}</Text>
          <Button label="Send for review" loading={busy === "submit"} onPress={() => void run("submit", () => api(`/api/listings/mine/${l.id}/submit/`, { method: "POST" }), "Sent. We’ll tell you when it’s checked.", "We couldn’t send it for review yet.")} />
        </View>
      ) : null}

      {l.status === "published" ? (
        <View style={{ gap: 14 }}>
          <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>{l.stock_quantity != null ? `${l.stock_quantity} in stock` : "Stock isn’t counted for this listing"}</Text>
          <Field label="Add stock" value={add} onChangeText={(v) => setAdd(v.replace(/\D/g, ""))} keyboardType="number-pad" />
          <Button label="Add to stock" loading={busy === "restock"} disabled={add === "" || Number(add) < 1} onPress={() => void run("restock", async () => { await api(`/api/listings/mine/${l.id}/restock/`, { body: { add: Number(add) } }); setAdd(""); }, "Stock updated.", "We couldn’t update the stock.")} />
          <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>To change the name, price or photos of a live listing, use the AshantiHub website; changes are checked before customers see them.</Text>
          <Button variant="secondary" label="Hide listing" loading={busy === "drop"} onPress={() => void run("drop", () => api(`/api/listings/mine/${l.id}/drop/`, { method: "POST" }), "Hidden. Customers can’t see it.", "We couldn’t hide it.")} />
        </View>
      ) : null}

      {l.status === "dropped" ? (
        <Button label="Show listing again" loading={busy === "restore"} onPress={() => void run("restore", () => api(`/api/listings/mine/${l.id}/restore/`, { method: "POST" }), "It’s live again.", "We couldn’t show it again.")} />
      ) : null}

      {note ? <Text accessibilityLiveRegion="polite" style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{note}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
    </Screen>
  );
}
