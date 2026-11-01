import { router } from "expo-router";
import { FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CategoryChips } from "../../features/browse/CategoryChips";
import { ListingCard } from "../../features/browse/ListingCard";
import { useDeals, useDepartments, useListings } from "../../features/browse/queries";
import { useAuth } from "../../state/auth";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { CartButton } from "../../ui/CartButton";
import { EmptyState } from "../../ui/EmptyState";
import { Skeleton } from "../../ui/Skeleton";

const open = (id: number) => router.push(`/listing/${id}` as never);

export default function CustomerHome() {
  const { c } = useTheme();
  const name = useAuth((s) => s.account?.fullName.split(" ")[0]);
  const departments = useDepartments();
  const deals = useDeals();
  const fresh = useListings({});
  const rows = fresh.data?.pages[0]?.results ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <FlatList
        data={rows}
        keyExtractor={(l) => String(l.id)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 20, gap: 14 }}
        ListHeaderComponent={
          <View style={{ gap: 16, marginBottom: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text accessibilityRole="header" style={{ flex: 1, color: c.ink, fontFamily: fonts.display, fontSize: 30 }}>
                {name ? `Akwaaba, ${name}` : "Akwaaba"}
              </Text>
              {useAuth.getState().account ? <CartButton /> : null}
            </View>
            <Pressable
              accessibilityRole="search"
              accessibilityLabel="Search AshantiHub"
              onPress={() => router.push("/customer/explore")}
              style={{ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, justifyContent: "center", paddingHorizontal: 14 }}
            >
              <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 15 }}>Search food, stays, tours, crafts</Text>
            </Pressable>
            <CategoryChips departments={departments.data ?? []} onSelect={(slug) => router.push({ pathname: "/customer/explore", params: slug ? { category: slug } : {} })} />
            {deals.data && deals.data.length > 0 ? (
              <View style={{ gap: 10 }}>
                <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 20 }}>Deals</Text>
                <FlatList
                  horizontal
                  data={deals.data}
                  keyExtractor={(l) => `deal-${l.id}`}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 12, paddingRight: 20 }}
                  renderItem={({ item }) => <ListingCard compact listing={item} onPress={open} />}
                />
              </View>
            ) : null}
            <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 20 }}>Discover</Text>
            {fresh.isPending ? <Skeleton height={220} /> : null}
            {fresh.isError ? <EmptyState title="We couldn't load listings" action={{ label: "Try again", onPress: () => fresh.refetch() }} /> : null}
          </View>
        }
        renderItem={({ item }) => <ListingCard listing={item} onPress={open} />}
      />
    </SafeAreaView>
  );
}
