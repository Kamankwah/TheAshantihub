import { describe, expect, it, vi, beforeEach } from "vitest";
import { importWithRetry, isChunkLoadError } from "./lazyWithRetry.js";

describe("importWithRetry", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("returns the module when the first try works", async () => {
    const factory = vi.fn().mockResolvedValue({ default: "ok" });
    await expect(importWithRetry(factory, { delayMs: 0 })).resolves.toEqual({ default: "ok" });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("tries once more after a failure", async () => {
    const factory = vi.fn().mockRejectedValueOnce(new Error("Loading chunk 7 failed")).mockResolvedValue({ default: "ok" });
    await expect(importWithRetry(factory, { delayMs: 0 })).resolves.toEqual({ default: "ok" });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("reloads the page once when the chunk is still missing, never in a loop", async () => {
    const reload = vi.fn();
    const factory = vi.fn().mockRejectedValue(new Error("Failed to fetch dynamically imported module"));
    importWithRetry(factory, { delayMs: 0, reload }); // stays pending: the page is going away
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    // A second failure right after the reload surfaces to the error boundary instead.
    await expect(importWithRetry(factory, { delayMs: 0, reload })).rejects.toThrow("dynamically imported module");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("isChunkLoadError", () => {
  it("recognises the browsers' messages", () => {
    for (const message of ["Loading chunk 12 failed", "Failed to fetch dynamically imported module: /assets/x.js", "Importing a module script failed."]) {
      expect(isChunkLoadError(new Error(message))).toBe(true);
    }
    expect(isChunkLoadError(new Error("x is undefined"))).toBe(false);
  });
});
