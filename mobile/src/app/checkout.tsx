import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { canPay, checkoutBody, fieldErrors, waitForPayment, type CheckoutForm } from "../features/cart/checkout";
import { useCart, useDeliveryPreview } from "../features/cart/queries";
import { useCanBuy } from "../features/listing/queries";
import { api } from "../lib/api";
import { apiMessage } from "../lib/errors";
import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Field } from "../ui/Field";
import { formatCedis, Price } from "../ui/Price";
import { Skeleton } from "../ui/Skeleton";

function Choice({ label, selected, onPress, disabled, children }: { label: string; selected?: boolean; onPress?: () => void; disabled?: boolean; children?: React.ReactNode }) {
  const { c, radius } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 56, borderRadius: radius.control, borderWidth: selected ? 2 : 1, borderColor: selected ? c.ink : c.line, backgroundColor: c.surface, padding: 14, justifyContent: "center", opacity: disabled ? 0.5 : 1 }}
    >
      {children}
    </Pressable>
  );
}

export default function CheckoutScreen() {
  const { c } = useTheme();
  const cart = useCart();
  const { canBuy, message: closedText } = useCanBuy();
  const [form, setForm] = useState<CheckoutForm>({ method: "store_pickup", address: "", phone: "", gps: "", landmark: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [locating, setLocating] = useState(false);
  const stop = useRef(false);
  const [stopped, setStopped] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => () => { stop.current = true; }, []);

  const door = form.method === "door_to_door";
  const preview = useDeliveryPreview(door, form.lat, form.lng);
  const quote = door ? preview.data?.delivery : null;
  const fee = quote && quote.fee != null && quote.fee_status !== "out_of_area" ? Number(quote.fee) : null;
  const items = Number(cart.data?.total ?? 0);
  const total = items + (fee ?? 0);
  const set = (patch: Partial<CheckoutForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors({});
  };

  async function pin() {
    setLocating(true);
    setError(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setError("Location is off. You can still enter your GhanaPost address; the delivery fee is worked out once a point is set.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      set({ lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) });
    } catch {
      setError("We couldn’t get your location. Try again outside or near a window.");
    } finally {
      setLocating(false);
    }
  }

  async function pay() {
    setBusy(true);
    setError(null);
    setErrors({});
    stop.current = false;
    try {
      const res = await api<{ id?: number; mode?: string; checkout_url?: string; reference?: string }>("/api/orders/checkout/", { body: checkoutBody(form) });
      if (res.mode === "redirect" && res.reference) {
        setWaiting(true);
        if (res.checkout_url) void WebBrowser.openBrowserAsync(res.checkout_url);
        const settled = await waitForPayment(res.reference, () => stop.current);
        if (!mounted.current) return; // left the screen while waiting: no surprise jump
        setWaiting(false);
        if (settled.status === "paid") {
          router.replace({ pathname: "/order-confirmed", params: { id: String(settled.orderId ?? "") } } as never);
        } else if (settled.status === "failed") {
          setError("Your payment didn’t go through. Nothing was taken and your cart is unchanged.");
        } else if (settled.status === "stopped") {
          if (!mounted.current) return;
          setStopped(true);
        } else if (settled.status === "timeout") {
          setError("We’re still waiting for your payment. If you paid, it will appear under Orders shortly.");
        }
        return;
      }
      router.replace({ pathname: "/order-confirmed", params: { id: String(res.id) } } as never);
    } catch (e) {
      const fe = fieldErrors(e);
      setErrors(fe);
      setError(Object.keys(fe).length ? null : apiMessage(e, "We couldn’t place your order. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/cart" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
      <Feather name="arrow-left" size={24} color={c.ink} />
    </Pressable>
  );

  if (cart.isLoading) return <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas, padding: 20 }}><Skeleton height={160} /></SafeAreaView>;
  if (cart.isError || !cart.data) {
    return <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>{back}<EmptyState title="We couldn’t load your cart" action={{ label: "Try again", onPress: () => void cart.refetch() }} /></SafeAreaView>;
  }
  if (cart.data.items.length === 0) {
    return <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>{back}<EmptyState title="Your cart is empty" action={{ label: "Start browsing", onPress: () => router.replace("/customer/explore" as never) }} /></SafeAreaView>;
  }

  const feeUnknown = door && fee == null;
  const payLabel = feeUnknown ? "Pay with Mobile Money (delivery fee added)" : `Pay ${formatCedis(total)} with Mobile Money`;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16 }}>
        {back}
        <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>Checkout</Text>

        <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>How do you want it?</Text>
        <View accessibilityRole="radiogroup" style={{ gap: 12 }}>
          <Choice label="Store pickup" selected={!door} onPress={() => set({ method: "store_pickup" })}>
            <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>Store pickup</Text>
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>Collect it from the seller. No address needed.</Text>
          </Choice>
          <Choice label="Door-to-door delivery" selected={door} onPress={() => set({ method: "door_to_door" })}>
            <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>Door-to-door delivery</Text>
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>A rider brings it to you in the Ashanti Region.</Text>
          </Choice>
        </View>

        {door ? (
          <View style={{ gap: 14 }}>
            <Field label="Delivery address" value={form.address} onChangeText={(v) => set({ address: v })} error={errors.address} autoComplete="street-address" />
            <Field label="Phone for the rider" value={form.phone} onChangeText={(v) => set({ phone: v })} error={errors.phone} keyboardType="phone-pad" autoComplete="tel" />
            <Field label="GhanaPost digital address" value={form.gps} onChangeText={(v) => set({ gps: v })} error={errors.gps} autoCapitalize="characters" autoCorrect={false} helper="For example AK-039-5028. Ashanti Region codes start with A." />
            <Field label="Nearest landmark" value={form.landmark} onChangeText={(v) => set({ landmark: v })} error={errors.landmark} helper="So the rider can find your door." />
            <Button
              variant="secondary"
              label="Use my current location as the delivery point"
              onPress={() => void pin()}
              loading={locating}
            />
            <Text style={{ color: form.lat !== undefined ? c.ink : c.dim, fontFamily: fonts.body, fontSize: 13 }}>
              {form.lat !== undefined ? "Delivery point set. Stand at your delivery door when you tap this." : "Tap this while you are at your delivery door, so we can work out the delivery fee."}
            </Text>
            {errors.pin ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 13 }}>{errors.pin}</Text> : null}
          </View>
        ) : null}

        <View style={{ backgroundColor: c.well, borderRadius: 12, padding: 14, gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 15 }}>Items</Text>
            <Price amount={items} />
          </View>
          {door ? (
            fee != null ? (
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 15 }}>Delivery</Text>
                <Price amount={fee} />
              </View>
            ) : (
              <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{quote?.message ?? "The delivery fee is worked out at checkout from your GhanaPost address."}</Text>
            )
          ) : null}
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>Total</Text>
            <Price amount={total} style={{ fontSize: 20 }} />
          </View>
        </View>

        <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>Pay with</Text>
        <View accessibilityRole="radiogroup" style={{ gap: 12 }}>
          <Choice label="Mobile Money" selected>
            <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>Mobile Money</Text>
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>You approve the payment on your phone.</Text>
          </Choice>
          <Choice label="AshantiHub wallet, not available yet" disabled>
            <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>AshantiHub wallet</Text>
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>Not available yet</Text>
          </Choice>
        </View>

        {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
        {waiting ? (
          <View style={{ gap: 10 }}>
            <Text accessibilityLiveRegion="polite" style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>Waiting for your payment…</Text>
            <Button variant="secondary" label="Stop waiting" onPress={() => { stop.current = true; }} />
          </View>
        ) : stopped ? (
          <View style={{ gap: 10 }}>
            <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>We stopped waiting. If you paid, check your orders in a few minutes; please don’t pay twice.</Text>
            <Button label="View my orders" onPress={() => router.replace("/customer/orders" as never)} />
          </View>
        ) : canBuy ? (
          <Button label={payLabel} onPress={() => void pay()} loading={busy} disabled={!canPay(form)} />
        ) : (
          <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>{closedText}</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
