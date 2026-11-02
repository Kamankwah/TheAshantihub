import { blankWeek, copyMondayToWeekdays, toDays, validateWeek } from "../src/features/business/hours";

describe("opening hours rules", () => {
  it("every_open_day_needs_both_times", () => {
    const week = blankWeek();
    week[0] = { closed: false, opens: "08:00", closes: "" };
    expect(validateWeek(week)).toBe("Enter opening and closing times for Monday, or mark it closed.");
  });

  it("opening_must_be_before_closing", () => {
    const week = blankWeek().map(() => ({ closed: false, opens: "18:00", closes: "09:00" }));
    expect(validateWeek(week)).toMatch(/Monday: opening time must be before closing time/);
  });

  it("must_be_open_at_least_one_day", () => {
    const week = blankWeek().map(() => ({ closed: true, opens: "", closes: "" }));
    expect(validateWeek(week)).toBe("Your business must be open at least one day a week.");
  });

  it("a_full_valid_week_passes_and_serialises_with_weekday_numbers", () => {
    const week = blankWeek().map((d, i) => (i === 6 ? { closed: true, opens: "", closes: "" } : { closed: false, opens: "08:00", closes: "18:00" }));
    expect(validateWeek(week)).toBeUndefined();
    expect(toDays(week)[6]).toEqual({ weekday: 6, closed: true, opens: null, closes: null });
    expect(toDays(week)[0]).toEqual({ weekday: 0, closed: false, opens: "08:00", closes: "18:00" });
  });

  it("copy_monday_fills_tuesday_to_friday_only", () => {
    const week = blankWeek();
    week[0] = { closed: false, opens: "08:00", closes: "17:00" };
    const copied = copyMondayToWeekdays(week);
    expect(copied[4]).toEqual(week[0]);
    expect(copied[5]).toEqual(week[5]);
  });
});
