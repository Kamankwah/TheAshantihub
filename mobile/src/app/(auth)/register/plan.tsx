import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { RegistrationHeader } from "../../../features/business/RegistrationHeader";
import { messageFor } from "../../../lib/authApi";
import { listPlans, resumeRegistration, saveBusinessKind, startTrial, type Plan } from "../../../lib/registrationApi";
import { fonts } from "../../../theme/fonts";
import { useTheme } from "../../../theme/useTheme";
import { Button } from "../../../ui/Button";
import { EmptyState } from "../../../ui/EmptyState";
import { Price } from "../../../ui/Price";
import { Screen } from "../../../ui/Screen";
import { Skeleton } from "../../../ui/Skeleton";

/** The plans may arrive bare or wrapped in a page; anything else counts as no plans rather than crashing the step. */
function asList(data: unknown): Plan[] {
  if (Array.isArray(data)) return data as Plan[];
  const wrapped = (data as { results?: unknown } | null | undefined)?.results;
  return Array.isArray(wrapped) ? (wrapped as Plan[]) : [];
}

export default function PlanStep() {
  const { c } = useTheme();
  const [kind, setKind] = useState<"product" | "service">();
  const [tier, setTier] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const plans = useQuery({ queryKey: ["plans"], queryFn: listPlans });
  const shown = asList(plans.data).filter((p) => p.kind === kind);
  // Subscriptions off: once the server has answered with an empty list there is nothing to choose, so the step is only
  // "Your Business Type". While plans load, or if they failed to load, the plan wording stays; only an answered empty list counts.
  const typeOnly = plans.isSuccess && (Array.isArray(plans.data) || Array.isArray((plans.data as { results?: unknown } | null)?.results)) && asList(plans.data).length === 0;
  // Plans are only asked for when this kind of business has some; otherwise it continues without choosing one.
  const needsPlan = shown.length > 0;

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      if (needsPlan && tier) await startTrial({ business_kind: kind!, plan: tier, cycle_months: 1 });
      else await saveBusinessKind(kind!);
      await resumeRegistration();
    } catch (e) {
      setError(messageFor(e, typeOnly ? "We couldn't save your business type. Try again." : "We couldn't save your plan. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const option = (selected: boolean, label: string, onPress: () => void, sub?: React.ReactNode) => (
    <Pressable
      key={label}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{ minHeight: 56, padding: 14, borderRadius: 16, borderWidth: selected ? 2 : 1, borderColor: selected ? c.gold : c.line, backgroundColor: c.surface, gap: 4 }}
    >
      <Text style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 16 }}>{label}</Text>
      {sub}
    </Pressable>
  );

  return (
    <Screen>
      <RegistrationHeader step={4} title={typeOnly ? "Your Business Type" : "Choose your plan"} back />
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14 }}>{typeOnly ? "What kind of business is this?" : "What will you sell?"}</Text>
      {option(kind === "product", "Products", () => { setKind("product"); setTier(undefined); })}
      {option(kind === "service", "Services, stays and events", () => { setKind("service"); setTier(undefined); })}
      {plans.isPending ? <Skeleton height={72} /> : null}
      {plans.isError ? <EmptyState title="We couldn't load the plans" action={{ label: "Try again", onPress: () => plans.refetch() }} /> : null}
      {kind && !plans.isPending && !plans.isError && !needsPlan && !typeOnly ? (
        <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>There are no plans for this yet. You can continue, and we will tell you when plans open.</Text>
      ) : null}
      {kind && needsPlan ? (
        <View style={{ gap: 10 }}>
          {shown.map((p) =>
            option(
              tier === p.tier,
              p.name,
              () => setTier(p.tier),
              <View style={{ flexDirection: "row", gap: 6, alignItems: "baseline" }}>
                <Price amount={p.monthly_price} />
                <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>a month</Text>
              </View>,
            ),
          )}
        </View>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 13 }}>{error}</Text> : null}
      <Button label="Continue" onPress={submit} loading={busy} disabled={!kind || plans.isPending || (needsPlan && !tier)} />
    </Screen>
  );
}
