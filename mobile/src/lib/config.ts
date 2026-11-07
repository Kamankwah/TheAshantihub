const STAGING_API = "https://api-test.theashantihub.com";
export const PRODUCTION_API = "https://api.theashantihub.com";

/**
 * The API this build talks to, always named by the EAS profile (eas.json). A build made without it fails at start-up instead of
 * quietly talking to the test database (review MOB-04); only the dev server (`__DEV__`) falls back to staging.
 */
function resolveApiBase(): string {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (__DEV__) return STAGING_API;
  throw new Error("EXPO_PUBLIC_API_BASE_URL is not set in this build. Build with an eas.json profile that defines it.");
}
export const API_BASE = resolveApiBase();

/** True for every build that is not pointed at the live API; the app shows an "ENV: staging" badge for them. */
export const IS_NON_PRODUCTION = API_BASE !== PRODUCTION_API;

/** The public website, where the legal pages live (they open in the in-app browser). */
export const WEB_BASE = (process.env.EXPO_PUBLIC_WEB_BASE_URL ?? "https://theashantihub.com").replace(/\/$/, "");

export const LEGAL_DOCS: Record<string, { title: string; path: string }> = {
  terms: { title: "Terms of use", path: "/terms" },
  privacy: { title: "Privacy policy", path: "/privacy" },
  "business-agreement": { title: "Business agreement", path: "/business-agreement" },
  "account-deletion": { title: "How to delete your account", path: "/account-deletion" },
};

/** AshantiHub's own WhatsApp (a business telling AshantiHub about an update). Never a business's number. */
export const SUPPORT_WHATSAPP = "https://wa.me/233502481685";
