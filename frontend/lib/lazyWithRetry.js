import { lazy } from "react";

// A route chunk that fails to download (flaky 3G, or a tab left open across a deploy so the old hashed file is gone) must not
// leave a blank page (review FE-01). Try the import once more; if it still fails, reload the page once to pick up the new build;
// if that did not help either, throw so the error boundary shows "Try again". The reload is guarded by a sessionStorage stamp so a
// genuinely broken chunk can never reload in a loop.
const RELOAD_KEY = "ah_chunk_reload";
const RELOAD_WINDOW_MS = 30_000;

export function importWithRetry(factory, { retries = 1, delayMs = 400, reload = () => window.location.reload() } = {}) {
  const attempt = (left) =>
    factory().catch((error) => {
      if (left > 0) {
        return new Promise((resolve) => setTimeout(resolve, delayMs)).then(() => attempt(left - 1));
      }
      let reloadedRecently = false;
      try {
        const last = Number(window.sessionStorage.getItem(RELOAD_KEY) || 0);
        reloadedRecently = Date.now() - last < RELOAD_WINDOW_MS;
        if (!reloadedRecently) window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      } catch {
        reloadedRecently = true; // no storage: do not risk a reload loop
      }
      if (reloadedRecently) throw error;
      reload();
      return new Promise(() => {}); // the page is going away; keep Suspense showing its fallback meanwhile
    });
  return attempt(retries);
}

export function lazyWithRetry(factory, options) {
  return lazy(() => importWithRetry(factory, options));
}

export function isChunkLoadError(error) {
  const text = `${error?.name || ""} ${error?.message || ""}`;
  return /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed|error loading dynamically/i.test(text);
}
