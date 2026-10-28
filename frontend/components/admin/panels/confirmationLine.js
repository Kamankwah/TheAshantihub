// The one honest sentence about whether the owner's confirmation text went out,
// from a server `confirmation` object ({state, sent_to_masked, sent_at,
// expires_at, send_note}). Shared by the draft list and the registration
// result. It never says "sent" unless the server says the text went out, and it
// carries no token, link or whole number: the server sends none.
const day = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

export function confirmationLine(confirmation) {
  if (!confirmation) return "";
  const { state, sent_to_masked: masked, sent_at: sentAt, expires_at: expiresAt, send_note: note } = confirmation;
  if (state === "lapsed") return "Link expired";
  if (state === "owner_confirmed") return "Waiting for approval";
  if (state === "owner_declined") return "The owner declined this";
  if (state === "withdrawn") return "Withdrawn";
  if (state === "submitted") return "With approval";
  if (state === "published") return "Live";
  if (state === "draft") return note || "Not sent to the owner yet";
  const expires = expiresAt ? `, expires ${day(expiresAt)}` : "";
  // A draft carries sent_at (set only when the provider took the text); the registration result carries the note alone.
  if (sentAt || note === "Text sent") return `Text sent${masked ? ` to ${masked}` : ""}${sentAt ? ` on ${day(sentAt)}` : ""}${expires}`;
  return `${note || "Not sent"}${masked ? ` (${masked})` : ""}`;
}
