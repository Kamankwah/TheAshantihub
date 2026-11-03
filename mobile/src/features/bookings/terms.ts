// What a customer is told before paying for, or after paying for, a service, stay or ticket. Ported from the web
// (frontend/lib/bookingTerms.js, components/bookings/bookingMoney.js). Every amount and time is the server's; nothing here
// works out a refund or a release time. Accra time is UTC all year, so every time shown is read in UTC.

export type Tier = [number, number];
export type LedgerTerms = {
  enabled: boolean;
  policies?: Record<string, { label: string; text: string; tiers: Tier[] }>;
  event_release_delay_hours?: number;
  service_auto_accept_hours?: number;
  stay_issue_window_hours?: number;
};
/** The `money` block the server adds to a paid booking, ticket or service while the ledger is on. */
export type Money = {
  sale: number;
  release_at: string | null;
  released_at: string | null;
  accepted_at: string | null;
  refunded: string | null;
  refunded_whole: boolean;
  problem: "open" | "closed" | null;
  policy: { policy?: string; text?: string; tiers?: Tier[] } | null;
  start: string | null;
  can_cancel: boolean;
  cancelled_by_you: boolean;
  can_report: boolean;
};
export type BookingKind = "service" | "stay" | "tickets";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

export function formatAccra(date: Date): string {
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export const hoursText = (hours: number) => `${hours} hour${hours === 1 ? "" : "s"}`;

/** One line per step of the policy still ahead of `now`, or the single honest line when none is. */
export function refundLines(tiers: Tier[], start: Date, now: Date): string[] {
  const lines: string[] = [];
  for (const [hours, share] of [...tiers].sort((a, b) => b[0] - a[0])) {
    const cutoff = new Date(start.getTime() - hours * 3600 * 1000);
    if (now > cutoff) continue;
    lines.push(share >= 10000 ? `Free cancellation until ${formatAccra(cutoff)}` : `${share / 100}% refund until ${formatAccra(cutoff)}`);
  }
  return lines.length ? lines : ["No refund if you cancel now"];
}

/** The terms shown above the Buy button for tickets; null while the terms are unknown or the ledger is off. */
export function ticketTerms(terms: LedgerTerms | undefined, refundDays: number | null | undefined, eventDate: string | null | undefined, now: Date = new Date()) {
  if (!terms || terms.enabled === false || terms.event_release_delay_hours == null) return null;
  let cancel: string[];
  let extra: string | null = null;
  if (refundDays == null) {
    cancel = ["No refund after purchase"];
    extra = "Tickets are refunded in full if the event is cancelled.";
  } else if (eventDate) {
    cancel = refundLines([[refundDays * 24, 10000]], new Date(eventDate), now);
  } else return null;
  return { cancel, extra, release: `The organiser is paid ${hoursText(terms.event_release_delay_hours)} after the event day ends.` };
}

const PAYEE: Record<BookingKind, string> = { service: "business", stay: "host", tickets: "organiser" };
const at = (iso: string) => formatAccra(new Date(iso));

export function refundLine(money: Money): string | null {
  if (!money.refunded) return null;
  return money.refunded_whole
    ? `Refunded in full: GH₵ ${money.refunded} went back to your AshantiHub wallet.`
    : `GH₵ ${money.refunded} went back to your AshantiHub wallet.`;
}

export function moneyLines(money: Money | null | undefined, kind: BookingKind, now: Date = new Date()): string[] {
  if (!money) return [];
  const P = PAYEE[kind];
  const lines: string[] = [];
  const refund = refundLine(money);
  if (refund) lines.push(refund);
  if (money.problem === "open") {
    lines.push(`Problem reported. Support is looking into it, and the payment to the ${P} is on hold until it is settled.`);
    return lines;
  }
  if (money.problem === "closed") lines.push("Support has settled the problem you reported.");
  if (money.released_at && money.accepted_at) lines.push(`You accepted this on ${at(money.accepted_at)}. The business has been paid.`);
  else if (money.released_at) lines.push(`The ${P} was paid on ${at(money.released_at)}.`);
  else if (money.refunded && !money.refunded_whole && money.cancelled_by_you) lines.push(`The ${P} keeps the rest under the cancellation policy.`);
  else if (money.release_at && new Date(money.release_at) <= now) lines.push(`The ${P} is due to be paid now.`);
  else if (money.release_at) {
    const canReport = money.problem !== "closed" && money.can_report !== false;
    if (kind === "service") lines.push(`Accepts automatically on ${at(money.release_at)}${canReport ? " unless you report a problem" : ""}.`);
    else lines.push(`The ${P} is paid on ${at(money.release_at)}${canReport ? " unless you report a problem before then" : ""}.`);
  }
  return lines;
}

export function policyLines(money: Pick<Money, "policy" | "start"> | null | undefined, now: Date = new Date()): string[] {
  const policy = money?.policy;
  if (!policy || !money) return [];
  if (!money.start) return ["Full refund any time before the business marks the job done"];
  if (!policy.tiers?.length) return [];
  return refundLines(policy.tiers, new Date(money.start), now);
}

/** The stay's start: its check-in date at the check-in time ("HH:MM", Accra). */
export function stayStart(checkInDate: string | null | undefined, checkInTime: string | null | undefined): Date | null {
  if (!checkInDate || !checkInTime) return null;
  const date = new Date(`${checkInDate}T${checkInTime}:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
