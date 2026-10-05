// The visitor's cookie-banner choice, remembered across visits so the banner
// doesn't return on every page load. "accepted" (Accept All) or "essential"
// (Essential Only); null means no choice yet. Storage can be unavailable
// (private mode, blocked site data) — then the banner simply shows again.
const KEY = "ashantihub.cookie_consent";

export function readCookieConsent() {
  try {
    const value = localStorage.getItem(KEY);
    return value === "accepted" || value === "essential" ? value : null;
  } catch {
    return null;
  }
}

export function saveCookieConsent(value) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Storage unavailable: the choice still holds for this page load.
  }
}
