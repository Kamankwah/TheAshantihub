import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { useMe } from "../../features/business/queries";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Pill } from "../../ui/Pill";
import { Screen } from "../../ui/Screen";
import { Skeleton } from "../../ui/Skeleton";
import { VerifiedBadge } from "../../ui/VerifiedBadge";

const IDENTITY: Record<string, { tone: "success" | "warn" | "error" | "neutral"; icon: "clock" | "alert-circle" | "file"; label: string }> = {
  not_submitted: { tone: "neutral", icon: "file", label: "ID not submitted" },
  pending: { tone: "warn", icon: "clock", label: "ID being checked" },
  rejected: { tone: "error", icon: "alert-circle", label: "ID needs attention" },
};

/** Where verification stands, in the API's own words. Reasons come from staff, not from this app. */
export default function VerificationScreen() {
  const { c } = useTheme();
  const q = useMe();
  const m = q.data;
  return (
    <Screen>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/business/more" as never))} style={{ width: 48, height: 48, justifyContent: "center" }}>
        <Feather name="arrow-left" size={24} color={c.ink} />
      </Pressable>
      <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 28 }}>Verification</Text>
      {q.isPending ? <Skeleton height={120} /> : null}
      {q.isError ? <EmptyState title="We couldn’t load this" action={{ label: "Try again", onPress: () => void q.refetch() }} /> : null}
      {m ? (
        <View style={{ gap: 14 }}>
          <View style={{ gap: 6 }}>
            <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>Your business</Text>
            {m.kyc_status === "verified" ? <VerifiedBadge /> : m.kyc_status === "rejected" ? <Pill tone="error" icon="alert-circle" label="Not verified yet" /> : <Pill tone="warn" icon="clock" label="Being checked" />}
            {m.kyc_status === "rejected" && m.kyc_rejection_reason ? <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>{m.kyc_rejection_reason}</Text> : null}
          </View>
          <View style={{ gap: 6 }}>
            <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>Your identity</Text>
            {m.identity_status === "verified" ? <VerifiedBadge /> : <Pill {...(IDENTITY[m.identity_status ?? "not_submitted"] ?? IDENTITY.not_submitted)} />}
            {m.identity_status === "rejected" && m.identity_rejection_reason ? <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>{m.identity_rejection_reason}</Text> : null}
          </View>
          <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 }}>
            A field scout checks your business in person. If something needs fixing, tell Support and we will help you resubmit.
          </Text>
          <Button variant="secondary" label="Contact Support" onPress={() => router.push({ pathname: "/support/new", params: { about: "My verification" } } as never)} />
        </View>
      ) : null}
    </Screen>
  );
}
