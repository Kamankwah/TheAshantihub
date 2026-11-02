import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { buildListingBody, canSave, type Draft, emptyDraft, fieldLines, listableCategories } from "../../features/business/newListing";
import { useBusinessKind, useCategoryTree, useZones } from "../../features/business/queries";
import { addDays, DateField, isoDay } from "../../features/seller/DateField";
import { useBookingTerms } from "../../features/seller/queries";
import { api, ApiError } from "../../lib/api";
import { apiMessage } from "../../lib/errors";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Field } from "../../ui/Field";
import { ChoiceRow, PickerRow } from "../../ui/PickerRow";
import { Screen } from "../../ui/Screen";
import { Skeleton } from "../../ui/Skeleton";

type Photo = { uri: string; name: string; type: string };
const MAX_PHOTOS = 9;
const text = (c: ReturnType<typeof useTheme>["c"]) => ({ color: c.dim, fontFamily: fonts.body, fontSize: 13 }) as const;

/** Create a listing: a product, food, service or stay. Saved as a draft, or sent for review at once. */
export default function NewListing() {
  const { c } = useTheme();
  const qc = useQueryClient();
  const tree = useCategoryTree();
  const zones = useZones();
  const kind = useBusinessKind();
  const terms = useBookingTerms();
  const [d, setD] = useState<Draft>(emptyDraft());
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState<"draft" | "review" | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [problem, setProblem] = useState<{ id: number; text: string } | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((f) => ({ ...f, [key]: value }));

  const categories = useMemo(() => listableCategories(tree.data ?? [], kind.data ?? null), [tree.data, kind.data]);
  const category = categories.find((r) => r.id === d.category);
  const stay = !!category?.isAccommodation;
  const policies = terms.data?.policies ?? {};

  async function addPhotos() {
    setErrors([]);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setErrors(["Allow photo access in your phone’s settings to add pictures."]);
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsMultipleSelection: true, selectionLimit: MAX_PHOTOS - photos.length });
      if (result.canceled) return;
      const added = result.assets.map((a) => ({ uri: a.uri, name: a.fileName ?? "photo.jpg", type: a.mimeType ?? "image/jpeg" }));
      setPhotos((p) => [...p, ...added].slice(0, MAX_PHOTOS));
    } catch {
      setErrors(["We couldn’t open your photos. Try again, or restart the app."]);
    }
  }

  async function save(send: boolean) {
    setBusy(send ? "review" : "draft");
    setErrors([]);
    setProblem(null);
    let id: number;
    try {
      const created = await api<{ id: number }>("/api/listings/mine/", { body: buildListingBody(d, category) });
      id = created.id;
    } catch (e) {
      const lines = e instanceof ApiError ? fieldLines(e.body) : [];
      setErrors(lines.length ? lines : [apiMessage(e, "We couldn’t save this listing. Check the details and try again.")]);
      setBusy(null);
      return;
    }
    void qc.invalidateQueries({ queryKey: ["owner-listings"] });
    let failedPhoto: string | null = null;
    for (const [i, p] of photos.entries()) {
      try {
        const form = new FormData();
        form.append("image", { uri: p.uri, name: p.name, type: p.type } as never);
        form.append("order", String(i));
        await api(`/api/listings/mine/${id}/photos/`, { method: "POST", body: form });
      } catch (e) {
        failedPhoto = apiMessage(e, "Try a smaller picture.");
        break;
      }
    }
    if (failedPhoto) {
      setProblem({ id, text: `Your listing was saved, but a photo was not added: ${failedPhoto} You can add photos again from the listing.` });
      setBusy(null);
      return;
    }
    if (send) {
      try {
        await api(`/api/listings/mine/${id}/submit/`, { method: "POST" });
        void qc.invalidateQueries({ queryKey: ["owner-listings"] });
      } catch (e) {
        setProblem({ id, text: `Your listing was saved as a draft, but it was not sent for review: ${apiMessage(e, "Try again from the listing.")}` });
        setBusy(null);
        return;
      }
    }
    setBusy(null);
    router.replace(`/manage/listing/${id}` as never);
  }

  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/business/listings" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
      <Feather name="arrow-left" size={24} color={c.ink} />
    </Pressable>
  );
  if (tree.isPending || zones.isPending || kind.isPending) return <Screen>{back}<Skeleton height={200} /></Screen>;
  if (tree.isError || zones.isError) {
    return <Screen>{back}<EmptyState title="We couldn’t load the form" action={{ label: "Try again", onPress: () => { void tree.refetch(); void zones.refetch(); } }} /></Screen>;
  }
  const ok = canSave(d, category);
  const isProduct = category?.kind === "product";
  const isService = category?.kind === "service" && !stay;
  return (
    <Screen>
      {back}
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 26 }}>New listing</Text>
      <PickerRow label="Category" placeholder="Choose a category" value={d.category} onChange={(v) => set("category", v)} options={categories.map((r) => ({ value: r.id, label: r.path }))} />
      <PickerRow label="Area" placeholder="Choose where you are" value={d.zone} onChange={(v) => set("zone", v)} options={(zones.data ?? []).map((z) => ({ value: z.id, label: z.name }))} />
      <Field label="Name" value={d.name} onChangeText={(v) => set("name", v)} />
      <Field label="Description" value={d.description} onChangeText={(v) => set("description", v)} multiline numberOfLines={4} textAlignVertical="top" style={{ minHeight: 100, paddingTop: 12 }} />
      <Field label={stay ? "Price per night in GH₵" : "Price in GH₵"} value={d.price} onChangeText={(v) => set("price", v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" />

      {isProduct ? (
        <View style={{ gap: 14 }}>
          <ChoiceRow label="Warranty *" value={d.hasWarranty} onChange={(v) => set("hasWarranty", v)} options={[{ value: "yes", label: "Yes, comes with a warranty" }, { value: "no", label: "No warranty" }]} />
          {d.hasWarranty === "yes" ? <Field label="Warranty details" value={d.warrantyDetails} onChangeText={(v) => set("warrantyDetails", v)} multiline numberOfLines={3} textAlignVertical="top" style={{ minHeight: 80, paddingTop: 12 }} /> : null}
          <ChoiceRow label="Expiry *" value={d.hasExpiry} onChange={(v) => set("hasExpiry", v)} options={[{ value: "yes", label: "Yes, has an expiry date" }, { value: "no", label: "No expiry date" }]} />
          {d.hasExpiry === "yes" ? (
            <DateField label="Expiry date" value={d.expiryDate ? new Date(`${d.expiryDate}T00:00:00`) : addDays(new Date(), 30)} minimum={new Date()} onChange={(date) => set("expiryDate", isoDay(date))} />
          ) : null}
          <Field label="Return policy" value={d.returnPolicy} onChangeText={(v) => set("returnPolicy", v)} multiline numberOfLines={3} textAlignVertical="top" style={{ minHeight: 80, paddingTop: 12 }} helper="For example: returns accepted within 7 days if unused." />
          <Field label="Brand (optional)" value={d.brand} onChangeText={(v) => set("brand", v)} />
          <ChoiceRow label="Condition (optional)" value={d.condition as "" | "new" | "used" | "refurbished"} onChange={(v) => set("condition", v)} options={[{ value: "new", label: "New" }, { value: "used", label: "Used" }, { value: "refurbished", label: "Refurbished" }]} />
          <Field label="Dimensions (optional)" value={d.dimensions} onChangeText={(v) => set("dimensions", v)} />
          <Field label="Weight (optional)" value={d.weight} onChangeText={(v) => set("weight", v)} />
          <Field label="Number in stock (leave empty if you don’t count)" value={d.stock} onChangeText={(v) => set("stock", v.replace(/\D/g, ""))} keyboardType="number-pad" />
          {!category?.isFood ? <Field label="Barcode (optional)" value={d.barcode} onChangeText={(v) => set("barcode", v)} keyboardType="number-pad" helper="Typed with spaces or hyphens is fine." /> : null}
        </View>
      ) : null}

      {isService ? (
        <View style={{ gap: 14 }}>
          <Text style={text(c)}>Customers can cancel a service for a full refund until you mark the job done.</Text>
          <Field label="How long it takes (optional)" value={d.duration} onChangeText={(v) => set("duration", v)} helper="For example: 2 hours." />
          <Field label="What’s included (optional)" value={d.included} onChangeText={(v) => set("included", v)} multiline numberOfLines={3} textAlignVertical="top" style={{ minHeight: 80, paddingTop: 12 }} />
          <Field label="What you need from the customer (optional)" value={d.requirements} onChangeText={(v) => set("requirements", v)} multiline numberOfLines={3} textAlignVertical="top" style={{ minHeight: 80, paddingTop: 12 }} />
          <Field label="Revisions (optional)" value={d.revisions} onChangeText={(v) => set("revisions", v)} />
          <Field label="Delivery time (optional)" value={d.deliveryTime} onChangeText={(v) => set("deliveryTime", v)} />
        </View>
      ) : null}

      {stay ? (
        <View style={{ gap: 14 }}>
          <Text style={text(c)}>The price above is charged per night. Guests book by date.</Text>
          <Field label="Rooms or units available" value={d.unitsTotal} onChangeText={(v) => set("unitsTotal", v.replace(/\D/g, ""))} keyboardType="number-pad" />
          <Field label="Check-in and check-out times (optional)" value={d.checkTimes} onChangeText={(v) => set("checkTimes", v)} helper="For example: check-in 2pm, check-out 11am." />
          <Field label="Amenities (optional)" value={d.amenities} onChangeText={(v) => set("amenities", v)} multiline numberOfLines={3} textAlignVertical="top" style={{ minHeight: 80, paddingTop: 12 }} />
          <Field label="House rules (optional)" value={d.houseRules} onChangeText={(v) => set("houseRules", v)} multiline numberOfLines={3} textAlignVertical="top" style={{ minHeight: 80, paddingTop: 12 }} />
          <PickerRow
            label="Cancellation policy"
            placeholder="Choose a policy"
            value={d.cancellationPolicy || null}
            onChange={(v) => set("cancellationPolicy", String(v))}
            options={Object.entries(policies).map(([name, p]) => ({ value: name, label: `${p.label}: ${p.text}` }))}
            disabled={Object.keys(policies).length === 0}
          />
          {terms.isError ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 13 }}>We couldn’t load the cancellation policies. Close and reopen this page.</Text> : null}
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <Button variant="secondary" label="Add photos" onPress={() => void addPhotos()} disabled={photos.length >= MAX_PHOTOS} />
        <Text style={text(c)}>{photos.length === 0 ? "A listing with pictures is checked faster. Up to 9 photos." : `${photos.length} ${photos.length === 1 ? "photo" : "photos"} chosen`}</Text>
      </View>

      {errors.map((line) => <Text key={line} accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{line}</Text>)}
      {problem ? (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{problem.text}</Text>
          <Button label="Open your listing" onPress={() => router.replace(`/manage/listing/${problem.id}` as never)} />
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <Button variant="secondary" label="Save as draft" onPress={() => void save(false)} loading={busy === "draft"} disabled={!ok || busy !== null} />
          <Button label="Save and send for review" onPress={() => void save(true)} loading={busy === "review"} disabled={!ok || busy !== null} />
          <Text style={text(c)}>A draft stays with you. Sent listings are checked by AshantiHub before customers see them.</Text>
        </View>
      )}
    </Screen>
  );
}
