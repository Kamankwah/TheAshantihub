import * as Sentry from "@sentry/react-native";

import { APP_BUILD, APP_VERSION } from "./appVersion";
import { API_BASE } from "./config";

// Crash and error reporting (review MOB-02). Off unless EXPO_PUBLIC_SENTRY_DSN is set in the EAS profile.
// What is sent: the error, its stack, the app version/build and the API environment. Never: the signed-in user, request bodies,
// headers, cookies, query strings, or anything shaped like an e-mail address, phone number or token (scrub() below).

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const PHONE = /(?:\+?233|\b0)\d{9}\b/g;
const TOKEN = /\b(?:Bearer\s+)?[A-Za-z0-9_-]{24,}\b/g;

export function scrubText<T>(text: T): T {
  return (typeof text === "string" ? text.replace(EMAIL, "[email]").replace(PHONE, "[phone]").replace(TOKEN, "[token]") : text) as T;
}

export function stripUrl<T>(url: T): T {
  if (typeof url !== "string") return url;
  const cut = url.search(/[?#]/);
  return (cut === -1 ? url : url.slice(0, cut)) as T;
}

type LooseEvent = {
  user?: unknown;
  server_name?: string;
  request?: { url?: string };
  message?: string;
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: { message?: string; data?: Record<string, unknown> }[];
};

/** Sentry beforeSend: the event with personal data removed. */
export function scrub<E extends LooseEvent>(event: E): E {
  delete event.user;
  delete event.server_name;
  if (event.request) event.request = { url: stripUrl(event.request.url) };
  if (event.message) event.message = scrubText(event.message);
  for (const ex of event.exception?.values ?? []) ex.value = scrubText(ex.value);
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = scrubText(crumb.message);
    if (crumb.data) {
      for (const key of ["url", "to", "from"]) if (typeof crumb.data[key] === "string") crumb.data[key] = stripUrl(crumb.data[key]);
      delete crumb.data.body;
    }
  }
  return event;
}

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
export const telemetryEnabled = !!dsn;

/** Start crash reporting. Never throws: reporting must not be able to stop the app. */
export function initTelemetry() {
  if (!dsn) return;
  try {
    Sentry.init({
      dsn,
      environment: API_BASE.includes("api-test") ? "staging" : "production",
      release: `${APP_VERSION}+${APP_BUILD}`,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend: scrub as never,
      beforeBreadcrumb: (crumb) => (crumb.category === "console" ? null : crumb),
    });
  } catch {
    // the app runs without reporting
  }
}

export function reportError(error: unknown) {
  if (!telemetryEnabled) return;
  try {
    Sentry.captureException(error);
  } catch {
    // ignore
  }
}
