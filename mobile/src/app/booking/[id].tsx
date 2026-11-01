import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useCanBuy, useListing } from "../../features/listing/queries";
import type { ListingDetail } from "../../features/listing/types";
import { addDays, DateField, isoDay } from "../../features/seller/DateField";
import { useBookingTerms } from "../../features/seller/queries";
import { api, ApiError } from "../../lib/api";
import { apiMessage } from "../../lib/errors";
import { useAuth } from "../../state/auth";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Field } from "../../ui/Field";
import { Price } from "../../ui/Price";
import { Skeleton } from "../../ui/Skeleton";
import { Stepper } from "../../ui/Stepper";

type Quote = { available: boolean; units_free: number; nights: number; nightly_rate: string | null; units: number; total_price: string | null };

function Policy({ listing }: { listing: ListingDetail & { cancellation_policy?: string } }) {
  const { c } = useTheme();
  const terms = useBookingTerms();
  const policy = terms.data?.enabled === false ? undefined : terms.data?.policies?.[listing.cancellation_policy ?? ""];
  if (!policy) return null;
  return (
    <View style={{ backgroundColor: c.well, borderRadius: 12, padding: 14, gap: 4 }}>
      <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 14 }}>{`Cancellation: ${policy.label}`}</Text>
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>{policy.text}</Text>
    </View>
  );
}

function StayBooking({ listing }: { listing: ListingDetail }) {
  const { c } = useTheme();
  const { canBuy, message } = useCanBuy();
  const today = useMemo(() => new Date(), []);
  const [checkIn, setCheckIn] = useState(addDays(today, 1));
  const [nights, setNights] = useState(1);
  const [units, setUnits] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const checkOut = addDays(checkIn, nights);
  const quote = useQuery({
    queryKey: ["stay-quote", listing.id, isoDay(checkIn), isoDay(checkOut), units],
    queryFn: () => api<Quote>("/api/bookings/availability/", { query: { listing: listing.id, check_in: isoDay(checkIn), check_out: isoDay(checkOut), units } }),
  });
  const q = quote.data;
  const ready = canBuy && !!q?.available && q.total_price != null && units <= (q?.units_free ?? 0);

  async function book() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ mode?: string; checkout_url?: string }>("/api/bookings/", {
        body: { listing: listing.id, check_in: isoDay(checkIn), check_out: isoDay(checkOut), units },
      });
      if (res?.mode === "redirect" && res.checkout_url) {
        await WebBrowser.openBrowserAsync(res.checkout_url);
        return;
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? "Those dates aren’t available. Try different dates." : apiMessage(e, "We couldn’t book this stay. Try again."));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <View style={{ gap: 12 }}>
        <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 24 }}>Booking confirmed</Text>
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 15 }}>{`${listing.name}, ${isoDay(checkIn)} to ${isoDay(checkOut)}. You can see it under Orders.`}</Text>
        <Button label="View my orders" onPress={() => router.replace("/customer/orders" as never)} />
      </View>
    );
  }
  return (
    <View style={{ gap: 16 }}>
      <DateField label="Check-in" value={checkIn} minimum={addDays(today, 0)} onChange={setCheckIn} />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>Nights</Text>
        <Stepper label="night" value={nights} min={1} max={30} onChange={setNights} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>Rooms or units</Text>
        <Stepper label="unit" value={units} min={1} max={10} onChange={setUnits} />
      </View>
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{`Check-out ${checkOut.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long" })}`}</Text>
      {quote.isLoading ? <Skeleton height={48} /> : null}
      {q && !q.available ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>Those dates aren’t available. Try different dates.</Text> : null}
      {q?.available && q.total_price != null ? (
        <View style={{ gap: 2 }}>
          <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{`${q.nights} ${q.nights === 1 ? "night" : "nights"} at the nightly rate, ${q.units} ${q.units === 1 ? "unit" : "units"}`}</Text>
          <Price amount={q.total_price} style={{ fontSize: 24 }} />
        </View>
      ) : null}
      {quote.isError ? <EmptyState title="We couldn’t check those dates" action={{ label: "Try again", onPress: () => void quote.refetch() }} /> : null}
      <Policy listing={listing} />
      {!canBuy && message ? <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{message}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
      <Button label="Book this stay" onPress={book} loading={busy} disabled={!ready} />
    </View>
  );
}

function ServiceRequest({ listing }: { listing: ListingDetail }) {
  const { c } = useTheme();
  const { canBuy, message } = useCanBuy();
  const [text, setText] = useState("");
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/services/requests/", { body: { listing: listing.id, message: text.trim(), budget: budget.trim() === "" ? null : budget.trim() } });
      setSent(true);
    } catch (e) {
      setError(apiMessage(e, "We couldn’t send your request. Try again."));
    } finally {
      setBusy(false);
    }
  }
  if (sent) {
    return (
      <View style={{ gap: 12 }}>
        <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 24 }}>Request sent</Text>
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 15 }}>You’ll be notified when the business replies with a quote. You pay from your orders once you accept it.</Text>
        <Button label="View my orders" onPress={() => router.replace("/customer/orders" as never)} />
      </View>
    );
  }
  return (
    <View style={{ gap: 16 }}>
      <Field label="What do you need?" value={text} onChangeText={setText} multiline numberOfLines={4} textAlignVertical="top" style={{ minHeight: 110, paddingTop: 12 }} />
      <Field label="Your budget in GH₵ (optional)" value={budget} onChangeText={(v) => setBudget(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" />
      <Policy listing={listing} />
      {!canBuy && message ? <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{message}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
      <Button label="Send request" onPress={send} loading={busy} disabled={!canBuy || text.trim().length === 0} />
    </View>
  );
}

/** Book a stay (dates, units, the server's price) or ask for a service quote. */
export default function BookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const q = useListing(id);
  const account = useAuth((s) => s.account);
  const signedIn = useAuth((s) => s.status === "signedIn");
  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
      <Feather name="arrow-left" size={24} color={c.ink} />
    </Pressable>
  );
  let body;
  if (q.isLoading) body = <Skeleton height={160} />;
  else if (q.isError || !q.data) body = <EmptyState title="We couldn’t load this" action={{ label: "Try again", onPress: () => void q.refetch() }} />;
  else if (!signedIn) body = <EmptyState title="Sign in to continue" body="Book and request with a customer account." action={{ label: "Sign in", onPress: () => router.push("/welcome" as never) }} />;
  else if (account?.type !== "customer") body = <EmptyState title="Business accounts can’t book" body="Sign in with a customer account to book or request." />;
  else body = q.data.category?.is_accommodation ? <StayBooking listing={q.data} /> : <ServiceRequest listing={q.data} />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16 }}>
        {back}
        {q.data ? <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 26 }}>{q.data.name}</Text> : null}
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}
