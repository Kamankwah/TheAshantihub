/** The API this build talks to (staging until the owner promotes; see eas.json). */
export const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://api-test.theashantihub.com").replace(/\/$/, "");

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
