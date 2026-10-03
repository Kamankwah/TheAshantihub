import { useSyncExternalStore } from "react";

// Real connectivity for the staff app. `navigator.onLine` alone lies: phones
// on Wi-Fi with no uplink (captive portals, dead routers) and DevTools'
// offline emulation both keep it `true`. So two facts are tracked:
//   - navigatorOnline: navigator.onLine + the window online/offline events
//   - apiUnreachable:  set by apiClient when fetch itself rejects (no HTTP
//                      response at all); cleared by the next API response of
//                      any status, or by the window `online` event.
// offline = !navigatorOnline || apiUnreachable.

const ONLINE = Object.freeze({ offline: false });
const OFFLINE = Object.freeze({ offline: true });

let navigatorOnline = true;
let apiUnreachable = false;
let snapshot = ONLINE;
let initialized = false;
const listeners = new Set();

function recompute() {
  const next = !navigatorOnline || apiUnreachable ? OFFLINE : ONLINE;
  if (next === snapshot) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function onOnline() {
  navigatorOnline = true;
  apiUnreachable = false;
  recompute();
}

function onOffline() {
  navigatorOnline = false;
  recompute();
}

// Attached lazily, once, on first use — never at import time, and never
// outside a browser.
function ensureInitialized() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  navigatorOnline = typeof navigator === "undefined" ? true : navigator.onLine !== false;
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  snapshot = !navigatorOnline || apiUnreachable ? OFFLINE : ONLINE;
}

export function reportApiNetworkFailure() {
  ensureInitialized();
  apiUnreachable = true;
  recompute();
}

export function reportApiResponse() {
  ensureInitialized();
  apiUnreachable = false;
  recompute();
}

export function subscribeNetworkStatus(listener) {
  ensureInitialized();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNetworkStatus() {
  ensureInitialized();
  return snapshot;
}

const getServerSnapshot = () => ONLINE;

export function useNetworkStatus() {
  return useSyncExternalStore(subscribeNetworkStatus, getNetworkStatus, getServerSnapshot);
}

export function resetNetworkStatusForTests() {
  if (typeof window !== "undefined") {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  }
  initialized = false;
  navigatorOnline = true;
  apiUnreachable = false;
  snapshot = ONLINE;
  listeners.forEach((listener) => listener());
}
