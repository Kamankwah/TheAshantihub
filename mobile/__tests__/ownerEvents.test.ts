import { buildEventBody, canSubmitEvent, emptyEventForm, eventStart, eventStatus, validTime } from "../src/features/business/events";

const form = () => ({ ...emptyEventForm(), category: 4, zone: 5, name: " Kente Night ", description: " An evening. ", address: " Manhyia Palace ", date: "2026-11-20", time: "18:30", visibilityDays: 30 });

describe("owner events", () => {
  it("time_must_be_24_hour_hh_mm", () => {
    expect(validTime("18:30")).toBe(true);
    expect(validTime("6:30")).toBe(false);
    expect(validTime("24:00")).toBe(false);
    expect(validTime("18:60")).toBe(false);
  });
  it("the_start_is_the_typed_date_and_time_in_accra_time", () => {
    expect(eventStart("2026-11-20", "18:30")).toBe("2026-11-20T18:30:00Z");
    expect(eventStart("", "18:30")).toBeNull();
    expect(eventStart("2026-11-20", "bad")).toBeNull();
  });
  it("needs_every_required_field", () => {
    expect(canSubmitEvent(form())).toBe(true);
    expect(canSubmitEvent({ ...form(), visibilityDays: null })).toBe(false);
    expect(canSubmitEvent({ ...form(), address: " " })).toBe(false);
    expect(canSubmitEvent({ ...form(), time: "x" })).toBe(false);
    expect(canSubmitEvent({ ...form(), zone: null })).toBe(false);
  });
  it("builds_the_submit_body", () => {
    expect(buildEventBody({ ...form(), refundDays: "3" })).toEqual({
      category: 4, zone: 5, name: "Kente Night", description: "An evening.", address: "Manhyia Palace", event_date: "2026-11-20T18:30:00Z",
      visibility_days: 30, access_level: "public", refund_until_days_before: 3,
    });
    expect(buildEventBody(form()).refund_until_days_before).toBeNull();
  });
  it("status_words_follow_the_server_state", () => {
    expect(eventStatus({ status: "pending", paid_at: null }).label).toBe("Waiting for review");
    expect(eventStatus({ status: "approved", paid_at: null }).label).toBe("Approved, waiting for your payment");
    expect(eventStatus({ status: "approved", paid_at: "2026-11-01T00:00:00Z" }).label).toBe("Live");
    expect(eventStatus({ status: "rejected", paid_at: null }).label).toBe("Needs changes");
  });
});
