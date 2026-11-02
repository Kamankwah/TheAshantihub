import { formatAccra, hoursText, moneyLines, policyLines, refundLines, ticketTerms } from "../src/features/bookings/terms";

const terms = { enabled: true, event_release_delay_hours: 24, service_auto_accept_hours: 72, stay_issue_window_hours: 24 };

describe("booking terms", () => {
  it("formats_accra_time_in_utc", () => {
    expect(formatAccra(new Date("2026-11-06T06:05:00Z"))).toBe("Fri 6 Nov, 06:05");
  });
  it("hours_text_pluralises", () => {
    expect(hoursText(1)).toBe("1 hour");
    expect(hoursText(24)).toBe("24 hours");
  });
  it("refund_lines_skip_steps_already_passed_and_say_so_when_none_is_left", () => {
    const start = new Date("2026-11-10T12:00:00Z");
    const tiers: [number, number][] = [[48, 10000], [24, 5000]];
    expect(refundLines(tiers, start, new Date("2026-11-08T00:00:00Z"))).toEqual(["Free cancellation until Sun 8 Nov, 12:00", "50% refund until Mon 9 Nov, 12:00"]);
    expect(refundLines(tiers, start, new Date("2026-11-10T00:00:00Z"))).toEqual(["No refund if you cancel now"]);
  });
  it("ticket_terms_with_no_refund_window_say_no_refund_but_refund_on_cancel", () => {
    const t = ticketTerms(terms, null, "2026-11-20T18:00:00Z")!;
    expect(t.cancel).toEqual(["No refund after purchase"]);
    expect(t.extra).toBe("Tickets are refunded in full if the event is cancelled.");
    expect(t.release).toBe("The organiser is paid 24 hours after the event day ends.");
  });
  it("ticket_terms_with_refund_days_give_the_cut_off", () => {
    const t = ticketTerms(terms, 3, "2026-11-20T18:00:00Z", new Date("2026-11-01T00:00:00Z"))!;
    expect(t.cancel).toEqual(["Free cancellation until Tue 17 Nov, 18:00"]);
  });
  it("ticket_terms_render_nothing_when_the_ledger_terms_are_off", () => {
    expect(ticketTerms({ enabled: false }, null, "2026-11-20T18:00:00Z")).toBeNull();
    expect(ticketTerms(undefined, null, "2026-11-20T18:00:00Z")).toBeNull();
  });
  it("money_lines_use_only_the_servers_amounts_and_times", () => {
    const money = { sale: 4, release_at: "2026-11-21T06:00:00Z", released_at: null, accepted_at: null, refunded: null, refunded_whole: false, problem: null, policy: null, start: null, can_cancel: true, cancelled_by_you: false, can_report: true };
    expect(moneyLines(money, "tickets", new Date("2026-11-02T00:00:00Z"))).toEqual(["The organiser is paid on Sat 21 Nov, 06:00 unless you report a problem before then."]);
    expect(moneyLines({ ...money, refunded: "50.00", refunded_whole: true, release_at: null }, "stay")).toEqual(["Refunded in full: GH₵ 50.00 went back to your AshantiHub wallet."]);
    expect(moneyLines({ ...money, problem: "open" }, "service")[0]).toMatch(/Problem reported/);
    expect(moneyLines(null, "stay")).toEqual([]);
  });
  it("policy_lines_for_a_service_with_no_start_is_the_job_done_rule", () => {
    expect(policyLines({ policy: { policy: "flexible", tiers: [] }, start: null })).toEqual(["Full refund any time before the business marks the job done"]);
  });
});
