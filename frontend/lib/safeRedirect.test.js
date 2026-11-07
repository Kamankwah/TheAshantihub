import { describe, it, expect, vi, afterEach } from "vitest";
import { isTrustedCheckoutUrl, goToCheckout, UntrustedCheckoutUrlError } from "./safeRedirect.js";

const origin = "https://ashantihub.com";
const ok = (u) => isTrustedCheckoutUrl(u, { origin });

describe("isTrustedCheckoutUrl", () => {
  it("accepts https Hubtel hosts and subdomains", () => {
    expect(ok("https://pay.hubtel.com/abc")).toBe(true);
    expect(ok("https://payproxyapi.hubtel.com/x?y=1")).toBe(true);
    expect(ok("https://hubtel.com/")).toBe(true);
  });
  it("accepts same-origin paths", () => {
    expect(ok("/pay/return?ref=1")).toBe(true);
    expect(ok("https://ashantihub.com/pay")).toBe(true);
  });
  it.each([
    "javascript:alert(1)", "data:text/html,x", "http://pay.hubtel.com/x", "https://evilhubtel.com/x",
    "https://hubtel.com.evil.io/x", "https://user:pw@pay.hubtel.com/x", "https://evil.io/", "//evil.io/x", "", "   ", null, undefined, 42,
  ])("rejects %s", (u) => expect(ok(u)).toBe(false));
});

describe("goToCheckout", () => {
  it("sets location.href by default", () => {
    const loc = { origin: "http://localhost:3000", href: "" };
    vi.stubGlobal("location", loc);
    goToCheckout("https://pay.hubtel.com/abc");
    expect(loc.href).toBe("https://pay.hubtel.com/abc");
    vi.unstubAllGlobals();
  });
  afterEach(() => vi.restoreAllMocks());
  it("throws for an untrusted URL without navigating", () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { origin: "http://localhost:3000", assign });
    expect(() => goToCheckout("https://evil.io/")).toThrow(UntrustedCheckoutUrlError);
    expect(assign).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("navigates for a trusted URL", () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { origin: "http://localhost:3000", assign });
    goToCheckout("https://pay.hubtel.com/abc", "assign");
    expect(assign).toHaveBeenCalledWith("https://pay.hubtel.com/abc");
    vi.unstubAllGlobals();
  });
});
