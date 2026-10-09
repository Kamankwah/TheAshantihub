// Duplicate-match wording shared by the scout's Register wizard and the
// Operations screens that show the same server `matched`/`exact` keys.
export const MATCH_LABELS = { phone: "phone number", gps_address: "Ghana Post address", ghana_card: "Ghana Card number" };

export const alreadyBelongsText = (match) => `This ${MATCH_LABELS[match] || match} already belongs to another business.`;
