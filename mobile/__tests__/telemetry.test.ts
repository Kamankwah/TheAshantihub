import { scrub, scrubText, stripUrl, telemetryEnabled, reportError } from "../src/lib/telemetry";

jest.mock("@sentry/react-native", () => ({ init: jest.fn(), captureException: jest.fn() }));

describe("mobile telemetry (MOB-02)", () => {
  it("is off without a DSN, and reporting is then a no-op", () => {
    expect(telemetryEnabled).toBe(false);
    expect(() => reportError(new Error("x"))).not.toThrow();
  });
  it("redacts e-mails, Ghana phone numbers and long tokens", () => {
    expect(scrubText("ama@example.com 0244123456 +233244123456")).toBe("[email] [phone] [phone]");
    expect(scrubText("Bearer abcdefghijklmnopqrstuvwxyz012345")).toBe("[token]");
  });
  it("drops query strings and fragments", () => {
    expect(stripUrl("https://x.com/a?token=1#f")).toBe("https://x.com/a");
  });
  it("removes user, bodies and personal text from an event", () => {
    const event = scrub({
      user: { id: 1 },
      request: { url: "https://x.com/p?reset=abc" },
      message: "for a@b.co",
      exception: { values: [{ value: "phone 0244123456" }] },
      breadcrumbs: [{ message: "to a@b.co", data: { url: "https://x.com/q?x=1", body: "secret" } }],
    });
    expect(event.user).toBeUndefined();
    expect(event.request).toEqual({ url: "https://x.com/p" });
    expect(event.message).toBe("for [email]");
    expect(event.exception?.values?.[0].value).toBe("phone [phone]");
    expect(event.breadcrumbs?.[0].data).toEqual({ url: "https://x.com/q" });
  });
});
