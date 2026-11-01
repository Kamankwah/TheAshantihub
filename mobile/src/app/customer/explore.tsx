import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CategoryChips } from "../../features/browse/CategoryChips";
import { ListingCard } from "../../features/browse/ListingCard";
import { useDepartments, useListings } from "../../features/browse/queries";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { EmptyState } from "../../ui/EmptyState";
import { Field } from "../../ui/Field";
import { Skeleton } from "../../ui/Skeleton";

export default function Explore() {
  const { c } = useTheme();
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const params = useLocalSearchParams<{ category?: string }>();
  const [category, setCategory] = useState<string | undefined>(params.category);
  const departments = useDepartments();
  const listings = useListings({ search, category });

  useEffect(() => {
    const t = setTimeout(() => setSearch(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);

  const rows = listings.data?.pages.flatMap((p) => p.results) ?? [];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <View style={{ padding: 20, gap: 14 }}>
        <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>
          Explore
        </Text>
        <Field label="Search AshantiHub" value={text} onChangeText={setText} placeholder="Food, stays, tours, crafts" returnKeyType="search" />
        <CategoryChips departments={departments.data ?? []} selected={category} onSelect={setCategory} />
      </View>
      {listings.isPending ? (
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          <Skeleton height={220} />
          <Skeleton height={220} />
        </View>
      ) : listings.isError ? (
        <EmptyState title="We couldn't load listings" body="Check your connection and try again." action={{ label: "Try again", onPress: () => listings.refetch() }} />
      ) : (
        <FlatList
          testID="results-list"
          data={rows}
          keyExtractor={(l) => String(l.id)}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 14 }}
          renderItem={({ item }) => <ListingCard listing={item} onPress={(id) => router.push(`/listing/${id}` as never)} />}
          onEndReachedThreshold={0.5}
          onEndReached={() => listings.hasNextPage && !listings.isFetchingNextPage && listings.fetchNextPage()}
          ListEmptyComponent={<EmptyState title="Nothing found" body="Try a different word or department." />}
          ListFooterComponent={listings.isFetchingNextPage ? <Skeleton height={120} /> : undefined}
        />
      )}
    </SafeAreaView>
  );
}
