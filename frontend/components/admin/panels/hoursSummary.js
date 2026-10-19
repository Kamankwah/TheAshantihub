// A business's structured weekly hours (API `hours`: [{weekday 0=Mon, closed, opens, closes}]) as one compact line for
// staff panels. Never invents hours: no rows means "Hours not set"; the legacy free-text field is shown only as old text.
const NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const label = (d) => (d.closed ? "closed" : `${d.opens}-${d.closes}`);

export function hoursSummary(days) {
  const rows = [...(days || [])].sort((a, b) => a.weekday - b.weekday);
  const parts = [];
  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1].weekday === rows[j].weekday + 1 && label(rows[j + 1]) === label(rows[i])) j += 1;
    const span = i === j ? NAMES[rows[i].weekday] : `${NAMES[rows[i].weekday]}-${NAMES[rows[j].weekday]}`;
    parts.push(`${span} ${label(rows[i])}`);
    i = j + 1;
  }
  return parts.join(", ");
}

export function staffHoursText(business) {
  const text = hoursSummary(business?.hours);
  if (text) return text;
  const old = (business?.opening_hours || "").trim();
  return old ? `Hours not set (old text: ${old})` : "Hours not set";
}
