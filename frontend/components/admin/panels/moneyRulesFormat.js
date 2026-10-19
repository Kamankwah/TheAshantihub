// Converting between what the server stores (whole pesewas, basis points) and what a person types (GH₵, %).
// Done only at the edge: everything else on the page, and every request, stays in the server's units.

export const unitOf = (key) => (key.endsWith("_pesewas") ? "ghs" : key.endsWith("_bp") ? "percent" : key.endsWith("_hours") ? "hours" : key.endsWith("_minutes") ? "minutes" : key.endsWith("_seconds") ? "seconds" : "count");

const ghs = (pesewas) => (pesewas / 100).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function showValue(key, value) {
  if (value === null || value === undefined) return "No limit";
  const unit = unitOf(key);
  if (unit === "ghs") return `GH₵ ${ghs(value)}`;
  if (unit === "percent") return `${value / 100}%`;
  if (unit === "count") return String(value);
  return `${value} ${unit}`;
}

// The text in the edit box for a stored value.
export function toInput(key, value) {
  if (value === null || value === undefined) return "";
  const unit = unitOf(key);
  if (unit === "ghs") return (value / 100).toFixed(2);
  if (unit === "percent") return String(value / 100);
  return String(value);
}

// The whole number to send for what was typed, or null when it is blank, or NaN when it is not a number.
export function fromInput(key, text) {
  const typed = String(text).trim().replace(/,/g, "");
  if (typed === "") return null;
  if (!/^\d+(\.\d+)?$/.test(typed)) return NaN;
  const unit = unitOf(key);
  if (unit === "ghs" || unit === "percent") return Math.round(Number(typed) * 100);
  return /^\d+$/.test(typed) ? Number(typed) : NaN;
}

// The server labels carry their raw unit ("(pesewas)", "(basis points; 1000 = 10%)"); the page shows GH₵ and %, so drop it.
export const plainLabel = (label) => label.replace(/\s*\((?:[^)]*\b)?(?:pesewas|basis points)\b[^)]*\)/i, "");

// A message for a typed value outside what the server allows, in the units the person typed; null when it is fine.
export function rangeError(setting, value) {
  if (value === null || value === undefined) return null;
  const { minimum: low, maximum: high } = setting;
  if ((low == null || value >= low) && (high == null || value <= high)) return null;
  return `Must be between ${showValue(setting.key, low ?? 0)} and ${showValue(setting.key, high)}.`;
}

export const GROUPS = [
  ["Fees", ["fee_cap_pesewas"]],
  ["When money is released", ["verification_overdue_hours", "pickup_window_hours", "service_auto_accept_hours", "stay_issue_window_hours", "event_release_delay_hours"]],
  ["Withdrawals and top-ups", ["withdrawal_per_tx_limit_pesewas", "withdrawal_daily_limit_pesewas", "payout_cooling_hours", "wallet_topup_hold_minutes"]],
  ["Riders", ["rider_commission_bp", "rider_withdrawals_per_day"]],
  ["Texts to businesses", ["vendor_low_balance_pesewas", "digest_batch_size", "digest_time_budget_seconds"]],
  ["Low-stock alerts", ["low_stock_cover_days", "low_stock_fallback_units", "stock_cover_window_days"]],
  ["Sign-in security", ["otp_daily_failure_cap"]],
];

// Settings the page does not know a group for still appear, under "Other", so a new server setting is never hidden.
export function groupSettings(settings) {
  const byKey = Object.fromEntries(settings.map((s) => [s.key, s]));
  const placed = new Set(GROUPS.flatMap(([, keys]) => keys));
  const groups = GROUPS.map(([title, keys]) => [title, keys.map((k) => byKey[k]).filter(Boolean)]).filter(([, rows]) => rows.length);
  const other = settings.filter((s) => !placed.has(s.key));
  return other.length ? [...groups, ["Other", other]] : groups;
}
