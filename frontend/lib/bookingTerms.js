// What a customer is told before paying for a service, stay or ticket, worked out from the real data: the
// listing's policy tiers (from /api/ledger/booking-terms/), the start time and the governed release hours.
// Accra time is UTC all year, so every time shown is read in UTC.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");

export function formatAccra(date) {
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export function hoursText(hours) {
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

// The start of a stay: the check-in date at the check-in time ("HH:MM", Accra).
export function stayStart(checkInDate, checkInTime) {
  if (!checkInDate) return null;
  const date = new Date(`${checkInDate}T${checkInTime}:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// One line per step of the policy that is still ahead of `now`, or the single honest line when none is.
// A tier is [hours before the start, share in basis points]; the cut-off instant itself still counts.
export function refundLines(tiers, start, now) {
  const lines = [];
  for (const [hours, share] of [...tiers].sort((a, b) => b[0] - a[0])) {
    const cutoff = new Date(start.getTime() - hours * 3600 * 1000);
    if (now > cutoff) continue;
    lines.push(share >= 10000 ? `Free cancellation until ${formatAccra(cutoff)}` : `${share / 100}% refund until ${formatAccra(cutoff)}`);
  }
  return lines.length ? lines : ["No refund if you cancel now"];
}
