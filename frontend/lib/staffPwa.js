import { useSyncExternalStore } from "react";

// Staff PWA runtime (docs/superpowers/specs/2026-10-03-staff-pwa-responsive-
// design.md §2.2–2.4): the manifest/apple head tags exist only on /staff*
// pages (so the public marketplace is never installable), the service worker
// is registered only from there with scope "/staff", and a tiny external
// store exposes install/update state to the shell's InstallAppButton and
// UpdateToast.

const STAFF_HEAD_ATTR = "data-staff-pwa";
const STAFF_HEAD_TAGS = [
  ["link", { rel: "manifest", href: "/staff.webmanifest" }],
  ["link", { rel: "apple-touch-icon", href: "/icons/apple-touch-icon-180x180.png" }],
  ["meta", { name: "mobile-web-app-capable", content: "yes" }],
  ["meta", { name: "apple-mobile-web-app-capable", content: "yes" }],
  ["meta", { name: "apple-mobile-web-app-title", content: "AH Staff" }],
  ["meta", { name: "apple-mobile-web-app-status-bar-style", content: "default" }],
];

export function isStaffPathname(pathname) {
  return pathname === "/staff" || pathname.startsWith("/staff/");
}

// viewport-fit=cover lets the staff shell paint under the notch / home
// indicator (it pads itself with env(safe-area-inset-*)). The public pages
// have no safe-area padding, so it is added to the one existing viewport meta
// only on /staff* and the original content is restored on the way out.
const VIEWPORT_FIT = "viewport-fit=cover";
const VIEWPORT_ORIGINAL_ATTR = "data-staff-pwa-original-content";

function setViewportFit(enabled) {
  const viewport = document.head.querySelector('meta[name="viewport"]');
  if (!viewport) return;
  const stored = viewport.getAttribute(VIEWPORT_ORIGINAL_ATTR);
  if (enabled) {
    if (stored !== null) return;
    const original = viewport.getAttribute("content") ?? "";
    viewport.setAttribute(VIEWPORT_ORIGINAL_ATTR, original);
    if (!/viewport-fit\s*=/.test(original)) {
      viewport.setAttribute("content", original ? `${original}, ${VIEWPORT_FIT}` : VIEWPORT_FIT);
    }
  } else if (stored !== null) {
    viewport.setAttribute("content", stored);
    viewport.removeAttribute(VIEWPORT_ORIGINAL_ATTR);
  }
}

export function ensureStaffHead(enabled) {
  if (typeof document === "undefined") return;
  setViewportFit(enabled);
  const existing = document.head.querySelectorAll(`[${STAFF_HEAD_ATTR}]`);
  if (!enabled) {
    existing.forEach((el) => el.remove());
    return;
  }
  if (existing.length > 0) return;
  for (const [tag, attrs] of STAFF_HEAD_TAGS) {
    const el = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    el.setAttribute(STAFF_HEAD_ATTR, "");
    document.head.appendChild(el);
  }
}

function detectStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)")?.matches === true || window.navigator.standalone === true;
}

function detectIOS() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

const initialState = () => ({ needRefresh: false, installPrompt: null, isStandalone: detectStandalone(), isIOS: detectIOS() });

let state = initialState();
let started = false;
let updateServiceWorker = null;
const listeners = new Set();

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function getSnapshot() {
  return state;
}

export function useStaffPwa() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function isStandaloneDisplay() {
  return detectStandalone();
}

function onBeforeInstallPrompt(event) {
  event.preventDefault(); // keep the browser's mini-infobar quiet; the shell offers its own button
  setState({ installPrompt: event });
}
function onAppInstalled() {
  setState({ installPrompt: null, isStandalone: true });
}

export async function startStaffPwa({ register, enableServiceWorker = import.meta.env.PROD } = {}) {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onAppInstalled);
  if (!enableServiceWorker) return;
  if (!register && !("serviceWorker" in navigator)) return;
  try {
    const registerSW = register ?? (await import("virtual:pwa-register")).registerSW;
    updateServiceWorker = registerSW({ onNeedRefresh: () => setState({ needRefresh: true }) });
  } catch (error) {
    console.warn("AshantiHub Staff: service worker registration failed", error);
  }
}

export async function promptInstall() {
  const prompt = state.installPrompt;
  if (!prompt) return;
  setState({ installPrompt: null }); // a deferred prompt can only be shown once
  await prompt.prompt();
  try {
    await prompt.userChoice;
  } catch {
    // dismissed — nothing to do
  }
}

export function applyUpdate() {
  updateServiceWorker?.(true);
}

export function resetStaffPwaForTests(overrides = {}) {
  if (typeof window !== "undefined") {
    window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.removeEventListener("appinstalled", onAppInstalled);
  }
  started = false;
  updateServiceWorker = null;
  state = { ...initialState(), ...overrides };
  listeners.forEach((listener) => listener());
}
