import { Text, View } from "react-native";

import { useFlashInvitations, whenText } from "../../features/business/promotions";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { BackButton } from "../../ui/BackButton";
import { EmptyState } from "../../ui/EmptyState";
import { formatCedis } from "../../ui/Price";
import { Screen } from "../../ui/Screen";
import { Skeleton } from "../../ui/Skeleton";

const ANSWER: Record<string, string> = { agreed: "You agreed", declined: "You declined", asked: "Waiting for your answer", mixed: "Partly answered" };

/** Flash sales AshantiHub invited this business to. Read-only: answering is done on the website. */
export default function FlashInvitations() {
  const { c, radius } = useTheme();
  const q = useFlashInvitations();
  const rows = q.data?.results ?? [];
  return (
    <Screen>
      <BackButton fallback="/manage/promotions" />
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>Flash-sale invitations</Text>
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>You can’t answer here yet. Answer on the AshantiHub website.</Text>
      {q.isLoading ? <Skeleton height={100} /> : null}
      {q.isError ? <EmptyState title="We couldn’t load your invitations" action={{ label: "Try again", onPress: () => void q.refetch() }} /> : null}
      {q.data && rows.length === 0 ? <EmptyState title="No flash-sale invitations yet" body="When AshantiHub invites you to a sale, it shows here." /> : null}
      {rows.map((r) => (
        <View key={r.sale_id} style={{ borderRadius: radius.card, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, padding: 16, gap: 4 }}>
          <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>{r.name}</Text>
          <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{ANSWER[r.answer] ?? r.answer}</Text>
          <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{`${whenText(r.starts_at)} to ${whenText(r.ends_at)}${r.discount_pct != null ? ` · ${r.discount_pct}% off` : ""}`}</Text>
          {r.listings.map((l) => <Text key={l.id} style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{`${l.name}: ${formatCedis(l.sale_price)} instead of ${formatCedis(l.normal_price)}`}</Text>)}
        </View>
      ))}
    </Screen>
  );
}
