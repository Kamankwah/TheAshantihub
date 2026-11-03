import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { buildEventBody, canSubmitEvent, emptyEventForm, type EventForm, usePricingTiers, validTime } from "../../features/business/events";
import { useCategoryTree, useZones } from "../../features/business/queries";
import { addDays, DateField, isoDay } from "../../features/seller/DateField";
import { api, ApiError } from "../../lib/api";
import { apiMessage } from "../../lib/errors";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Field } from "../../ui/Field";
import { ChoiceRow, PickerRow } from "../../ui/PickerRow";
import { formatCedis } from "../../ui/Price";
import { Screen } from "../../ui/Screen";
import { Skeleton } from "../../ui/Skeleton";
import type { CategoryNode } from "../../features/business/newListing";

type Photo = { uri: string; name: string; type: string };

function eventCategories(tree: CategoryNode[]): { id: number; label: string }[] {
  const rows: { id: number; label: string }[] = [];
  const walk = (nodes: CategoryNode[], trail: string[]) => {
    for (const n of nodes) {
      const path = [...trail, n.label];
      if (n.kind === "event") rows.push({ id: n.id, label: path.join(" › ") });
      walk(n.children ?? [], path);
    }
  };
  walk(tree, []);
  return rows;
}

/** Submit an event. Our team checks it; once it is approved you pay to show it for the days you chose. */
export default function NewEvent() {
  const { c } = useTheme();
  const qc = useQueryClient();
  const tree = useCategoryTree();
  const zones = useZones();
  const tiers = usePricingTiers();
  const [f, setF] = useState<EventForm>(() => ({ ...emptyEventForm(), date: isoDay(addDays(new Date(), 1)) }));
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: number; text: string } | null>(null);
  const set = <K extends keyof EventForm>(k: K, v: EventForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const categories = useMemo(() => eventCategories(tree.data ?? []), [tree.data]);

  async function addPhoto() {
    setError(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError("Allow photo access in your phone’s settings to add a picture.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
      const a = result.canceled ? undefined : result.assets[0];
      if (a) setPhoto({ uri: a.uri, name: a.fileName ?? "event.jpg", type: a.mimeType ?? "image/jpeg" });
    } catch {
      setError("We couldn’t open your photos. Try again, or restart the app.");
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setProblem(null);
    let id: number;
    try {
      id = (await api<{ id: number }>("/api/events/submit/", { body: buildEventBody(f) })).id;
    } catch (e) {
      setError(apiMessage(e, "We couldn’t send this event. Check the details and try again."));
      setBusy(false);
      return;
    }
    void qc.invalidateQueries({ queryKey: ["owner-events"] });
    if (photo) {
      try {
        const form = new FormData();
        form.append("media", { uri: photo.uri, name: photo.name, type: photo.type } as never);
        form.append("media_type", "image");
        form.append("order", "0");
        await api(`/api/events/${id}/media/`, { method: "POST", body: form });
      } catch (e) {
        setProblem({ id, text: `Your event was sent, but the photo was not added: ${apiMessage(e, "Try a smaller picture.")} You can add it again later on the website.` });
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    router.replace(`/manage/event/${id}` as never);
  }

  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/manage/events" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
      <Feather name="arrow-left" size={24} color={c.ink} />
    </Pressable>
  );
  if (tree.isPending || zones.isPending || tiers.isPending) return <Screen>{back}<Skeleton height={200} /></Screen>;
  if (tree.isError || zones.isError || tiers.isError) {
    return <Screen>{back}<EmptyState title="We couldn’t load the form" action={{ label: "Try again", onPress: () => { void tree.refetch(); void zones.refetch(); void tiers.refetch(); } }} /></Screen>;
  }
  const timeBad = f.time.trim() !== "" && !validTime(f.time);
  return (
    <Screen>
      {back}
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 26 }}>New event</Text>
      <PickerRow label="Category" placeholder="Choose a category" value={f.category} onChange={(v) => set("category", v)} options={categories.map((r) => ({ value: r.id, label: r.label }))} />
      <PickerRow label="Area" placeholder="Choose where it is" value={f.zone} onChange={(v) => set("zone", v)} options={(zones.data ?? []).map((z) => ({ value: z.id, label: z.name }))} />
      <Field label="Name" value={f.name} onChangeText={(v) => set("name", v)} />
      <Field label="Description" value={f.description} onChangeText={(v) => set("description", v)} multiline numberOfLines={4} textAlignVertical="top" style={{ minHeight: 100, paddingTop: 12 }} />
      <Field label="Address" value={f.address} onChangeText={(v) => set("address", v)} />
      <DateField label="Date" value={new Date(`${f.date}T00:00:00`)} minimum={new Date()} onChange={(d) => set("date", isoDay(d))} />
      <Field label="Start time (24-hour, like 18:00)" value={f.time} onChangeText={(v) => set("time", v)} keyboardType="numbers-and-punctuation" error={timeBad ? "Type the time like 18:00." : undefined} />
      <PickerRow
        label="How long it is shown"
        placeholder="Choose how many days"
        value={f.visibilityDays}
        onChange={(v) => set("visibilityDays", v)}
        options={(tiers.data ?? []).map((t) => ({ value: t.duration_days, label: `${t.duration_days} days, ${formatCedis(t.live_price)}` }))}
      />
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>You pay this only after our team approves your event.</Text>
      <ChoiceRow label="Who can see it" value={f.access} onChange={(v) => set("access", v)} options={[{ value: "public", label: "Public" }, { value: "private", label: "Private, with an access code" }]} />
      <Field label="Refund tickets until how many days before (optional)" value={f.refundDays} onChangeText={(v) => set("refundDays", v.replace(/\D/g, ""))} keyboardType="number-pad" helper="Leave empty and tickets are not refundable after purchase, only if the event is cancelled." />
      <View style={{ gap: 8 }}>
        <Button variant="secondary" label="Add a photo" onPress={() => void addPhoto()} />
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{photo ? "1 photo chosen" : "A picture helps people choose your event."}</Text>
      </View>
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
      {problem ? (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{problem.text}</Text>
          <Button label="Open your event" onPress={() => router.replace(`/manage/event/${problem.id}` as never)} />
        </View>
      ) : (
        <Button label="Send for review" onPress={() => void submit()} loading={busy} disabled={!canSubmitEvent(f) || busy} />
      )}
    </Screen>
  );
}
