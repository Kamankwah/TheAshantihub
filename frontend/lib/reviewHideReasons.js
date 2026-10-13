// The seven reasons a review can be hidden, with the message the reviewer is
// sent unless the moderator edits it. Mirrors backend/reviews/reasons.py (the
// server fills the same text when no message is sent); keep the two in step.
export const HIDE_REASONS = [
  ['contact_details', 'Contains contact details', "Thanks for your review of {about}. We couldn't publish it because it includes contact details. On AshantiHub all contact goes through AshantiHub Support. You're welcome to post it again without them."],
  ['no_purchase', "Can't confirm a real purchase or visit", "Thanks for your review of {about}. We couldn't publish it because we can't find a purchase or visit with them on your account. You're welcome to review once you have bought from them."],
  ['abusive', 'Abusive or hateful', "Thanks for your review of {about}. We couldn't publish it because it contains abusive or hateful language. You're welcome to post it again with the language removed."],
  ['personal_info', "Someone's personal information", "Thanks for your review of {about}. We couldn't publish it because it names or describes a private person. You're welcome to post it again without those details."],
  ['spam', 'Advertising or spam', "Thanks for your review of {about}. We couldn't publish it because it reads as advertising. You're welcome to post a review that describes your own experience."],
  ['not_about_business', 'Not about this business', "Thanks for your review of {about}. We couldn't publish it because it isn't about this business. You're welcome to post it where it belongs."],
  ['other', 'Other', "Thanks for your review of {about}. We couldn't publish it. If you have a question, contact AshantiHub Support."],
]

export function hideMessage(code, about) {
  const row = HIDE_REASONS.find(([id]) => id === code)
  return row ? row[2].replace('{about}', about || 'this listing') : ''
}
