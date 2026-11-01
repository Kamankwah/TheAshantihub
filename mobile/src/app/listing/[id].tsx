import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Modal, Pressable, Text, useWindowDimensions, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { useFlight } from "../../features/listing/flight";
import { openingMode, photoSources } from "../../features/listing/motion";
import { PhotoGallery } from "../../features/listing/PhotoGallery";
import { addToCart, useCanBuy, useCartGuard, useListing } from "../../features/listing/queries";
import type { Variant } from "../../features/listing/types";
import { useReducedMotion } from "../../features/listing/useReducedMotion";
import { apiMessage } from "../../lib/errors";
import { useAuth } from "../../state/auth";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Price } from "../../ui/Price";
import { Skeleton } from "../../ui/Skeleton";
import { VerifiedBadge } from "../../ui/VerifiedBadge";

const HEADER_H = 320;

function Stepper({ value, max, onChange, label }: { value: number; max: number; onChange: (n: number) => void; label: string }) {
  const { c } = useTheme();
  const btn = { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: c.line } as const;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`One fewer ${label}`} disabled={value <= 0} onPress={() => onChange(value - 1)} style={[btn, { opacity: value <= 0 ? 0.4 : 1 }]}>
        <Feather name="minus" size={18} color={c.ink} />
      </Pressable>
      <Text style={{ minWidth: 28, textAlign: "center", color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16, fontVariant: ["tabular-nums"] }}>{value}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`One more ${label}`} disabled={value >= max} onPress={() => onChange(value + 1)} style={[btn, { opacity: value >= max ? 0.4 : 1 }]}>
        <Feather name="plus" size={18} color={c.ink} />
      </Pressable>
    </View>
  );
}

/** The photo flies from where the card was to the header; with reduce-motion (or no card) the page just fades in. */
function FlightLayer({ onDone }: { onDone: () => void }) {
  const origin = useFlight((s) => s.origin);
  const { width } = useWindowDimensions();
  const progress = useSharedValue(0);
  const src = origin ? origin.uri : null;
  useEffect(() => {
    progress.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }, (done) => {
      if (done) {
        // hide the overlay once it has landed
      }
    });
    const t = setTimeout(onDone, 340);
    return () => clearTimeout(t);
  }, [progress, onDone]);
  const style = useAnimatedStyle(() => {
    if (!origin) return { opacity: 0 };
    const p = progress.value;
    return {
      position: "absolute",
      left: origin.x + (0 - origin.x) * p,
      top: origin.y + (0 - origin.y) * p,
      width: origin.width + (width - origin.width) * p,
      height: origin.height + (HEADER_H - origin.height) * p,
    };
  });
  if (!src) return null;
  return (
    <Animated.View pointerEvents="none" style={[{ zIndex: 5, overflow: "hidden" }, style]}>
      <Image source={{ uri: src }} contentFit="cover" style={{ flex: 1 }} accessibilityIgnoresInvertColors />
    </Animated.View>
  );
}

export default function ListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const query = useListing(id);
  const { canBuy, message: closedText } = useCanBuy();
  const account = useAuth((s) => s.account);
  const signedIn = useAuth((s) => s.status === "signedIn");
  const reduced = useReducedMotion();
  const origin = useFlight((s) => s.origin);
  const mode = openingMode(reduced, origin && String(origin.id) === String(id) ? origin : null);
  const [flying, setFlying] = useState(mode === "flight");
  const [galleryAt, setGalleryAt] = useState<number | null>(null);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCustomer = account?.type === "customer";
  const guard = useCartGuard(id, isCustomer);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const parallax = useAnimatedStyle(() => ({ transform: [{ translateY: scrollY.value * 0.4 }] }));
  const rise = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    rise.value = withTiming(1, { duration: reduced ? 150 : 380, easing: Easing.out(Easing.cubic) });
  }, [rise, reduced]);
  const riseStyle = useAnimatedStyle(() => ({ opacity: rise.value, transform: [{ translateY: (1 - rise.value) * 24 }] }));
  const pageFade = useSharedValue(mode === "fade" ? 0 : 1);
  useEffect(() => {
    if (mode === "fade") pageFade.value = withTiming(1, { duration: 200 });
  }, [mode, pageFade]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: pageFade.value }));

  if (query.isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
        <Skeleton height={HEADER_H} />
      </SafeAreaView>
    );
  }
  if (query.isError || !query.data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas, justifyContent: "center" }}>
        <EmptyState title="We couldn’t load this item" body="Check your connection and try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />
      </SafeAreaView>
    );
  }

  const item = query.data;
  const sources = photoSources(item.main_photo_variants ?? { thumb: item.main_photo, medium: item.main_photo, large: item.main_photo });
  const gallery = item.photos.length ? item.photos : [{ id: 0, image: item.main_photo ?? "", variants: item.main_photo_variants ?? { thumb: item.main_photo, medium: item.main_photo, large: item.main_photo } }];
  const variants: Variant[] = item.variants ?? [];
  const reviews = item.review_count ?? 0;
  const isService = item.category?.kind === "service" && !item.category?.is_food;
  const blocked = guard.data?.listing?.blocked ?? null;
  const picked = variants.filter((v) => (qty[v.id] ?? 0) > 0);
  const outOfStock = variants.length === 0 && item.stock_quantity === 0;
  const hasPrice = item.price_amount != null;
  const addDisabled =
    !canBuy || !hasPrice || outOfStock || !!blocked || (variants.length > 0 && picked.length === 0) || !isCustomer && signedIn;

  async function onAdd() {
    if (!signedIn) {
      router.push("/welcome" as never);
      return;
    }
    setError(null);
    setAdding(true);
    try {
      await addToCart(item.id, variants.length ? picked.map((v) => ({ variant: v.id, quantity: qty[v.id] })) : undefined);
      setQty({});
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    } catch (e) {
      setError(apiMessage(e, "We couldn’t add this to your cart. Try again."));
    } finally {
      setAdding(false);
    }
  }

  return (
    <Animated.View style={[{ flex: 1, backgroundColor: c.canvas }, fadeStyle]}>
      {flying ? <FlightLayer onDone={() => setFlying(false)} /> : null}
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 140 }}>
        <Pressable
          accessibilityRole="imagebutton"
          accessibilityLabel={`Photos of ${item.name}. Opens full screen`}
          onPress={() => setGalleryAt(0)}
          style={{ height: HEADER_H, overflow: "hidden", backgroundColor: c.well }}
        >
          <Animated.View style={[{ flex: 1 }, parallax]}>
            {sources.uri ? (
              <Image
                source={{ uri: sources.uri }}
                placeholder={sources.placeholder ? { uri: sources.placeholder } : undefined}
                contentFit="cover"
                transition={200}
                style={{ flex: 1, opacity: flying ? 0 : 1 }}
                accessibilityIgnoresInvertColors
              />
            ) : null}
          </Animated.View>
        </Pressable>

        <Animated.View style={[{ padding: 20, gap: 12 }, riseStyle]}>
          <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 26 }}>
            {item.name}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            {hasPrice ? <Price amount={item.effective_price ?? item.price_amount} style={{ fontSize: 22 }} /> : null}
            {item.was_price ? <Price amount={item.was_price} style={{ fontSize: 15, fontFamily: fonts.body, textDecorationLine: "line-through", color: c.dim }} /> : null}
          </View>
          <View style={{ gap: 6 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Seller ${item.business_owner.name}`} onPress={() => router.push(`/seller/${item.business_owner.id}` as never)} style={{ minHeight: 48, justifyContent: "center" }}>
              <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 16 }}>{item.business_owner.name}</Text>
            </Pressable>
            {item.business_owner.identity_verified ? <VerifiedBadge /> : null}
            {reviews > 0 && item.avg_rating ? (
              <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{`${Number(item.avg_rating).toFixed(1)} · ${reviews} ${reviews === 1 ? "review" : "reviews"}`}</Text>
            ) : null}
          </View>

          {variants.length === 0 && item.stock_quantity != null ? (
            <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>
              {item.stock_quantity === 0 ? "Out of stock" : `${item.stock_quantity} in stock`}
            </Text>
          ) : null}

          {variants.length > 0 ? (
            <View style={{ gap: 4 }}>
              <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>Choose options</Text>
              {variants.map((v) => {
                const out = v.stock_quantity === 0;
                return (
                  <View key={v.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.line }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>{v.label}</Text>
                      <Price amount={v.effective_price ?? v.price_amount} style={{ fontSize: 14 }} />
                      {out ? <Text style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 13 }}>Out of stock</Text> : null}
                    </View>
                    {!out ? (
                      <Stepper label={v.label} value={qty[v.id] ?? 0} max={v.stock_quantity ?? 99} onChange={(n) => setQty((q) => ({ ...q, [v.id]: n }))} />
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : null}

          {item.description ? <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 15, lineHeight: 22 }}>{item.description}</Text> : null}

          <View style={{ backgroundColor: c.well, borderRadius: 12, padding: 14, gap: 4 }}>
            <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 14 }}>Delivery and pickup</Text>
            <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>
              Choose door-to-door delivery or store pickup at checkout. The delivery fee is worked out at checkout from your GhanaPost address.
            </Text>
            {item.delivery_time ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{`Preparation: ${item.delivery_time}`}</Text> : null}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Contact Support"
            onPress={() => router.push({ pathname: "/support/new", params: { about: item.name, listing: String(item.id) } } as never)}
            style={{ minHeight: 48, justifyContent: "center" }}
          >
            <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15, textDecorationLine: "underline" }}>Contact Support</Text>
          </Pressable>
          <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>AshantiHub Support will help with questions about this item or seller.</Text>
        </Animated.View>
      </Animated.ScrollView>

      <SafeAreaView edges={["top"]} pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, zIndex: 10 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as never))}
          style={{ margin: 12, width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.9)", alignItems: "center", justifyContent: "center" }}
        >
          <Feather name="arrow-left" size={22} color="#2C1810" />
        </Pressable>
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} style={{ position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.line }}>
        <View style={{ padding: 16, gap: 8 }}>
          {!canBuy && closedText ? <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{closedText}</Text> : null}
          {blocked?.detail ? <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{blocked.detail}</Text> : null}
          {signedIn && !isCustomer ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>Business accounts can’t buy on AshantiHub. Sign in with a customer account to buy.</Text> : null}
          {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 14 }}>{error}</Text> : null}
          {isService ? (
            <Button label="Book or request" onPress={() => router.push(`/booking/${item.id}` as never)} disabled={!canBuy} />
          ) : (
            <Button label={added ? "Added to cart" : "Add to cart"} onPress={onAdd} loading={adding} disabled={addDisabled} />
          )}
        </View>
      </SafeAreaView>

      <Modal visible={galleryAt !== null} animationType="fade" onRequestClose={() => setGalleryAt(null)} statusBarTranslucent>
        <GestureHandlerRootView style={{ flex: 1 }}>
          {galleryAt !== null ? <PhotoGallery photos={gallery} initialIndex={galleryAt} onClose={() => setGalleryAt(null)} /> : null}
        </GestureHandlerRootView>
      </Modal>
    </Animated.View>
  );
}
