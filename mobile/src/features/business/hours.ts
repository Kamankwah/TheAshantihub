import type { HoursDay } from "../../lib/registrationApi";

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export type Row = { closed: boolean; opens: string; closes: string };

export const blankWeek = (): Row[] => DAY_NAMES.map(() => ({ closed: false, opens: "", closes: "" }));

export function fromDays(days?: HoursDay[]): Row[] {
  const byDay = new Map((days ?? []).map((d) => [d.weekday, d]));
  return DAY_NAMES.map((_, weekday) => {
    const d = byDay.get(weekday);
    return { closed: !!d?.closed, opens: d?.opens?.slice(0, 5) ?? "", closes: d?.closes?.slice(0, 5) ?? "" };
  });
}

/** A message for the first broken rule, or undefined when the week can be saved (same rules as the web editor). */
export function validateWeek(rows: Row[]): string | undefined {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.closed) continue;
    if (!r.opens || !r.closes) return `Enter opening and closing times for ${DAY_NAMES[i]}, or mark it closed.`;
    if (r.opens >= r.closes) return `${DAY_NAMES[i]}: opening time must be before closing time (overnight hours aren't supported).`;
  }
  if (rows.every((r) => r.closed)) return "Your business must be open at least one day a week.";
  return undefined;
}

export const toDays = (rows: Row[]): HoursDay[] =>
  rows.map((r, weekday) => ({ weekday, closed: r.closed, opens: r.closed ? null : r.opens, closes: r.closed ? null : r.closes }));

export const copyMondayToWeekdays = (rows: Row[]): Row[] => rows.map((r, i) => (i >= 1 && i <= 4 ? { ...rows[0] } : r));
