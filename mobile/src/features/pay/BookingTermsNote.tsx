import { Text, View } from "react-native";

import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import type { LedgerTerms } from "../bookings/terms";
import { ticketTerms } from "../bookings/terms";

/** Shown once above Buy: when the tickets can still be cancelled and when the organiser is paid. Nothing while the terms are unknown or the ledger is off. */
export function TicketTermsNote({ terms, refundDays, eventDate }: { terms: LedgerTerms | undefined; refundDays: number | null | undefined; eventDate: string | null | undefined }) {
  const { c } = useTheme();
  const t = ticketTerms(terms, refundDays, eventDate);
  if (!t) return null;
  return (
    <View style={{ gap: 2 }}>
      {t.cancel.map((l) => <Text key={l} style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 13 }}>{l}</Text>)}
      {t.extra ? <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{t.extra}</Text> : null}
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>{t.release}</Text>
    </View>
  );
}
