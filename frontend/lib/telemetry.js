// Browser error reporting (review FE-02). Off unless VITE_SENTRY_DSN is set at build time, and the SDK is
// imported lazily, so an unconfigured build (and the entry bundle) carries none of it.
//
// What is sent: the error, its stack, the page path (no query string or fragment) and the build's
// environment/release. What is never sent: cookies, headers, request bodies, IP addresses, the signed-in
// user, or anything that looks like an e-mail address, phone number or token (scrub() below).

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const PHONE = /(?:\+?233|\b0)\d{9}\b/g;
const TOKEN = /\b(?:Bearer\s+)?[A-Za-z0-9_-]{24,}\b/g;

export function scrubText(text) {
  return typeof text === "string" ? text.replace(EMAIL, "[email]").replace(PHONE, "[phone]").replace(TOKEN, "[token]") : text;
}

export function stripUrl(url) {
  if (typeof url !== "string") return url;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

// Sentry beforeSend: returns the event with personal data removed.
export function scrub(event) {
  if (!event) return event;
  delete event.user;
  delete event.server_name;
  if (event.request) {
    event.request = { url: stripUrl(event.request.url) };
  }
  if (event.message) event.message = scrubText(event.message);
  for (const ex of event.exception?.values || []) ex.value = scrubText(ex.value);
  for (const crumb of event.breadcrumbs || []) {
    if (crumb.message) crumb.message = scrubText(crumb.message);
    if (crumb.data) {
      for (const key of ["url", "to", "from"]) if (crumb.data[key]) crumb.data[key] = stripUrl(crumb.data[key]);
      delete crumb.data.body;
    }
  }
  return event;
}

let sentry = null;
let pending = [];

export function telemetryEnabled() {
  return Boolean(import.meta.env.VITE_SENTRY_DSN);
}

export async function initTelemetry() {
  if (!telemetryEnabled() || sentry) return;
  const lib = await import("@sentry/react");
  const rate = Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE);
  lib.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_RELEASE || undefined,
    sendDefaultPii: false,
    // Core Web Vitals ride on performance traces; sampled low, off by default.
    tracesSampleRate: Number.isFinite(rate) ? rate : 0,
    beforeSend: scrub,
    beforeBreadcrumb: (crumb) => (crumb.category === "console" ? null : crumb),
  });
  sentry = lib;
  for (const [error, info] of pending) lib.captureException(error, info);
  pending = [];
}

// Used by ErrorBoundary: reports a caught render error. A failed lazy chunk after a deploy is expected, not a bug.
export function reportError(error, info) {
  if (!telemetryEnabled()) return;
  if (/ChunkLoadError|dynamically imported module|Importing a module script failed/i.test(String(error?.message || error))) return;
  const extra = info?.componentStack ? { contexts: { react: { componentStack: info.componentStack } } } : undefined;
  if (sentry) sentry.captureException(error, extra);
  else pending.push([error, extra]);
}
