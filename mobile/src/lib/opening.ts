// Labels for the marketplace opening, always from the server's opens_at, in Accra time (the date is never hardcoded).
const TZ = "Africa/Accra";

function parts(opensAt: Date) {
  const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: TZ }).format(opensAt);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(opensAt);
  return { dayMonth, time };
}

export function opensAtDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The sentence shown wherever buying is closed. */
export function closedMessage(opensAt: Date | null): string {
  if (!opensAt) return "AshantiHub opens soon. You can browse now and buy once we open.";
  const { dayMonth, time } = parts(opensAt);
  return `AshantiHub opens on ${dayMonth} at ${time}. You can browse now and buy once we open.`;
}
