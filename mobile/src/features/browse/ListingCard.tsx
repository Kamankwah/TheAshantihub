import { Pressable, Text, View } from "react-native";

import { captureFlight } from "../listing/flight";
import { SharedPhoto } from "../listing/SharedPhoto";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Price } from "../../ui/Price";
import { VerifiedBadge } from "../../ui/VerifiedBadge";
import type { Listing } from "./types";

type Props = { listing: Listing; onPress: (id: number) => void; compact?: boolean };

/** One listing: photo, name, seller (verified mark only when staff verified the identity), price, honest rating. */
export function ListingCard({ listing, onPress, compact }: Props) {
  const { c, radius } = useTheme();
  const photo = listing.main_photo_variants?.thumb ?? listing.main_photo;
  const now = listing.effective_price ?? listing.price_amount;
  const reviews = listing.review_count ?? 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${listing.name}, ${listing.business_owner.name}`}
      onPress={() => void captureFlight(listing.id).then(() => onPress(listing.id))}
      style={({ pressed }) => ({
        width: compact ? 160 : undefined,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: c.line,
        backgroundColor: c.surface,
        overflow: "hidden",
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View style={{ height: compact ? 96 : 150, backgroundColor: c.well }}>
        {photo ? <SharedPhoto id={listing.id} uri={photo} style={{ flex: 1 }} /> : null}
        {listing.is_promoted ? (
          <View style={{ position: "absolute", top: 10, left: 10, backgroundColor: c.lightGold, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
            <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 12 }}>Promoted</Text>
          </View>
        ) : null}
      </View>
      <View style={{ padding: 12, gap: 4 }}>
        <Text numberOfLines={2} style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 15 }}>
          {listing.name}
        </Text>
        <Text numberOfLines={1} style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>
          {listing.business_owner.name}
        </Text>
        {listing.business_owner.identity_verified ? <VerifiedBadge /> : null}
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <Price amount={now} />
          {listing.was_price ? (
            <Price amount={listing.was_price} style={{ fontSize: 13, fontFamily: fonts.body, textDecorationLine: "line-through", color: c.dim }} />
          ) : null}
        </View>
        {reviews > 0 && listing.avg_rating ? (
          <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 13 }}>
            {`${Number(listing.avg_rating).toFixed(1)} · ${reviews} ${reviews === 1 ? "review" : "reviews"}`}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
