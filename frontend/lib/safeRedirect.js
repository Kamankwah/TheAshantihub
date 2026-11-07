// Leave the app for a hosted checkout only if the URL the API returned is one we trust.
// The backend is the authority on the URL, but a compromised or misconfigured response must not be
// able to send a shopper to an arbitrary site (open redirect / javascript: URL), so the browser checks too.

// Hubtel's hosted checkout lives on hubtel.com (pay.hubtel.com, payproxyapi.hubtel.com, ...).
const TRUSTED_HOST_SUFFIXES = ["hubtel.com"];

export class UntrustedCheckoutUrlError extends Error {
  constructor() {
    super("We couldn't open the payment page. Please try again or contact support.");
    this.name = "UntrustedCheckoutUrlError";
  }
}

export function isTrustedCheckoutUrl(raw, { origin = window.location.origin } = {}) {
  if (typeof raw !== "string" || !raw.trim()) return false;
  let url;
  try { url = new URL(raw.trim(), origin); } catch { return false; }
  if (url.username || url.password) return false;
  if (url.origin === origin) return url.protocol === "https:" || url.protocol === "http:";
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return TRUSTED_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

// Navigate to a checkout URL, or throw UntrustedCheckoutUrlError (callers already sit in a try/catch).
// `method` is "href" (assign to location.href) or "assign" (location.assign); both leave the page.
export function goToCheckout(raw, method = "href") {
  if (!isTrustedCheckoutUrl(raw)) throw new UntrustedCheckoutUrlError();
  const target = new URL(String(raw).trim(), window.location.origin || undefined).href;
  if (method === "assign") window.location.assign(target);
  else window.location.href = target;
}
