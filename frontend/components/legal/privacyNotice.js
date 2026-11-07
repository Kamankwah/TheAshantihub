// AshantiHub Privacy Notice - the words, kept apart from the page that lays them out so they can be read, tested and
// reused (the mobile app can show the same text).
//
// Shape: an "at a glance" list, then numbered sections. A section body is a list of blocks:
//   { p: "paragraph" }  |  { ul: ["item", ...] }  |  { terms: [["Term", "what it means"], ...] }
// Every statement here must stay true to the code; the facts it rests on are listed at the bottom of this file.
//
// Written for AshantiHub from three public frameworks rather than copied from any vendor's template:
//   - the notice contents the EU GDPR (Art. 13) and the UK ICO guidance set out, which is the usual reference for a
//     marketplace with accounts, payments and delivery;
//   - the Ghana Data Protection Act, 2012 (Act 843) and its principles (lawful and specific purpose, minimal data,
//     openness, security, data-subject participation, accountability);
//   - ISO/IEC 29100 privacy terms (controller, purpose, retention, rights).
// It is a plain-language document, not legal advice, and carries no section numbers it cannot back up. A Ghanaian
// lawyer must review it before it is relied on.

export const PRIVACY_UPDATED = "7 November 2026";

export const PRIVACY_GLANCE = [
  "We collect what we need to run your account, orders, deliveries, payments and support, and not more.",
  "We do not sell personal data and we do not share it with advertisers. No advertising network runs on this site.",
  "We never see or store your card number or mobile money PIN. Payments are handled by our payment provider.",
  "Businesses cannot message you directly. Anything to do with them goes through AshantiHub Support.",
  "You can ask to see, correct or delete your data, and you can stop marketing messages at any time.",
];

export const PRIVACY_SECTIONS = [
  {
    id: "who-we-are",
    title: "Who we are",
    body: [
      { p: "AshantiHub Ltd (\u201CAshantiHub\u201D, \u201Cwe\u201D) runs an online marketplace for businesses in Kumasi and the Ashanti Region of Ghana, on the web and in a mobile app. Under the Data Protection Act, 2012 (Act 843) we are the “data controller” for the personal data in this notice: we decide why and how it is used." },
      { p: "This notice explains what we collect, why, who sees it, how long we keep it and what you can do about it. If a word or a promise here is unclear, ask us (see Contact, at the end)." },
    ],
  },
  {
    id: "what-we-collect",
    title: "What we collect",
    body: [
      { p: "What we hold depends on how you use AshantiHub. We collect it from you, from what you do in the app, and from our payment provider (a payment status and reference)." },
      { terms: [
        ["Your account", "Your name, phone number and/or email address, and a password, which we keep only in scrambled (hashed) form. If you sign in with a one-time code, we send it by SMS or email, keep it only in hashed form, and it expires after five minutes."],
        ["Orders and delivery", "What you ordered, the amounts, and payment references. For door-to-door delivery: your delivery address, Ghana Post digital address, a landmark, a map pin and a phone number the rider can call. Store pickup needs none of the address details."],
        ["Payments and your wallet", "Which way you chose to pay, whether it went through, and its reference. Your AshantiHub wallet balance and transactions. If you withdraw money, the mobile money or bank account you save as a payout destination (number and account name). We do not collect card numbers or mobile money PINs."],
        ["If you sell on AshantiHub", "Your business name, type and description, listing photos and videos, opening hours, your shop location, and your contact details. When you ask to be paid out, we also collect identity details we need for that: your Ghana Card number and pictures of the card. These are kept in private storage, shown only to staff who need them, and never on a public link."],
        ["Messages, reports and reviews", "Your conversations with AshantiHub Support (including which business or listing they are about), problem reports and any photos you attach, and reviews you write."],
        ["Your choices", "Which kinds of marketing you agreed to (SMS, WhatsApp, email, in-app), when and how you agreed, and your cookie banner choice."],
        ["Location", "Only when you use a location feature: pinning your door, sharing your shop’s location, or “use my current location” for Deliver to. Your browser or phone asks your permission first. We keep a pin only where you save it, for example on a delivery address or a shop."],
        ["Listings you look at", "When you view a product or listing for a few seconds we record it, to power “Customers also viewed”. If you are signed in this is linked to your account; if you are not, it uses a random anonymous ID kept in your browser, not your name."],
        ["Security and technical data", "Your IP address and basic device and browser details in security logs and rate limits, sign-in attempts, and a trusted-device token so we do not ask for a code every time on a device you have already verified. Crash reports are described under Who we share it with."],
      ] },
    ],
  },
  {
    id: "why-we-use-it",
    title: "Why we use it",
    body: [
      { p: "Each use needs a lawful reason. These are ours:" },
      { terms: [
        ["Running your account and signing you in safely", "To carry out our agreement with you, and our legitimate interest in keeping accounts secure."],
        ["Taking, paying for and delivering orders; refunds and disputes", "To carry out our agreement with you."],
        ["Checking identity, preventing fraud, and meeting financial and legal rules", "To meet our legal obligations and our legitimate interest in preventing fraud."],
        ["Helping you through Support", "To carry out our agreement with you, and our legitimate interest in resolving problems."],
        ["Service messages (order updates, codes, security alerts)", "To carry out our agreement with you."],
        ["Marketing messages and offers", "Only your consent, channel by channel. You can withdraw it at any time and it does not affect your orders."],
        ["Keeping the service working and improving it", "Our legitimate interest in finding and fixing faults and understanding which listings are useful."],
      ] },
    ],
  },
  {
    id: "who-we-share-it-with",
    title: "Who we share it with",
    body: [
      { p: "We share personal data only where it is needed to do what you asked, and only as much as is needed." },
      { terms: [
        ["Our payment provider", "Handles mobile money and card payments. It tells us whether a payment succeeded; we do not hold your card number or PIN."],
        ["Delivery riders", "The pickup and drop-off addresses, a phone number to call, and the codes needed to hand over an order, for the job they are doing."],
        ["Sellers", "The details of an order for their items that they need to prepare it. Sellers cannot message you through AshantiHub; contact goes through AshantiHub Support."],
        ["Service providers acting for us", "Hosting (our servers are with Hetzner); sending SMS and email; crash reporting (Sentry, which receives error details with personal information removed first)."],
        ["Maps", "Map pictures come from OpenStreetMap or Mapbox, which therefore see your IP address and the area you are looking at. When you drop a pin, its coordinates may be sent to OpenStreetMap’s Nominatim service to suggest an address."],
        ["Videos", "A product page may embed a YouTube video, using YouTube’s privacy-enhanced mode, which does not set tracking cookies until you play it."],
        ["Authorities and advisers", "Where the law requires it, or to protect our rights, for example a court order or a regulator’s request, and to our professional advisers under a duty of confidence."],
      ] },
      { p: "We do not sell personal data, and we do not give it to advertisers." },
    ],
  },
  {
    id: "outside-ghana",
    title: "Data outside Ghana",
    body: [
      { p: "Some of the providers above, such as hosting and crash reporting, operate outside Ghana, so your data can be processed there. We choose providers that protect personal data and give each one only what it needs." },
    ],
  },
  {
    id: "how-long",
    title: "How long we keep it",
    body: [
      { p: "We keep personal data no longer than the purpose needs. Our current periods:" },
      { ul: [
        "Your account details: while your account is open. When you delete your account, we erase your name, contact details, address book, picture, identity and payout details and notifications.",
        "Order and payment records (items, totals, references, the money ledger): kept as financial records, without the personal detail around them once that detail has expired.",
        "Delivery address details and the text of support conversations: removed 90 days after you delete your account, or six years after the order, whichever comes first.",
        "In-app notifications: one year.",
        "Payment-provider notices and business text messages: about 13 months.",
        "Records of your marketing consent: kept for up to five years, as proof of what you agreed to.",
        "Security logs: kept, with addresses shortened.",
      ] },
      { p: "We cannot delete an account while money or work is still open on it, such as an open order, a withdrawal, a wallet balance or a live listing. We tell you what is holding it up. These periods can change as the law and our record-keeping needs change; we will update this notice when they do." },
    ],
  },
  {
    id: "security",
    title: "How we protect it",
    body: [
      { ul: [
        "Everything travels over HTTPS.",
        "Passwords and one-time codes are stored hashed.",
        "Identity documents are kept in private storage and opened only through short-lived links.",
        "Sign-in attempts are rate-limited and locked after repeated failures; sensitive actions, such as moving money, ask you to confirm again.",
        "Staff see only what their role needs, and their actions are recorded.",
      ] },
      { p: "No system is perfectly secure. If a breach is likely to harm you, we will tell you and the Data Protection Commission as the law requires." },
    ],
  },
  {
    id: "your-rights",
    title: "Your rights",
    body: [
      { p: "Under Act 843 you can:" },
      { ul: [
        "ask what personal data we hold about you and get a copy;",
        "ask us to correct data that is wrong or out of date;",
        "ask us to delete your data, as far as the law and open orders allow;",
        "object to how we use your data, or ask us to restrict it, in the cases the law gives you;",
        "stop marketing messages at any time, with the unsubscribe link in a message, in your account, or by telling Support;",
        "complain to us, and to the Data Protection Commission of Ghana if you are not satisfied.",
      ] },
      { p: "In the AshantiHub mobile app you can delete your account yourself (Delete my account). For anything else, contact us. We may need to confirm it is you first, and we will reply promptly and within the time the law allows." },
    ],
  },
  {
    id: "browser-storage",
    title: "Cookies and browser storage",
    body: [
      { p: "This website keeps a few items in your browser’s storage rather than using tracking cookies:" },
      { ul: [
        "your sign-in session, until you sign out;",
        "a trusted-device token, so a device you have verified is recognised;",
        "your light or dark theme, your Deliver to choice and your cookie banner choice;",
        "a guest chat token, if you start a Support chat without signing in;",
        "the anonymous viewer ID described under What we collect.",
      ] },
      { p: "We do not run advertising or third-party analytics trackers. If we ever add optional ones, they will stay off until you accept them." },
    ],
  },
  {
    id: "children",
    title: "Children",
    body: [
      { p: "AshantiHub is not meant for children, and we do not knowingly collect their personal data. If you think a child has given us personal data, tell us and we will delete it." },
    ],
  },
  {
    id: "changes",
    title: "Changes to this notice",
    body: [
      { p: "When we change this notice we update the date at the top. For a change that matters to you, we will tell you in the app, or by SMS or email, before it applies." },
    ],
  },
];

// Where each claim comes from (re-check when any of these change):
//   retention periods ......... backend/accounts/retention.py + settings PII_*, NOTIFICATION_*, WEBHOOK_*, VENDOR_TEXT_* defaults;
//                               consent proof 5 years: backend/marketing/views_consent.py RETENTION_YEARS (owner ruling 2026-11-07)
//   account deletion .......... backend/accounts/deletion.py (what is erased; refused while money or work is open);
//                               in-app: mobile/src/features/account/DeleteAccount.tsx
//   data held / copy of data .. backend/accounts/export.py
//   identity docs private ..... root CLAUDE.md "Identity documents never live under MEDIA_ROOT"
//   sign-in limits, step-up ... core.throttling, accounts.lockout, frontend/apiClient.js step-up
//   OTP hashed, 5-minute expiry docs/regulatory/BOG_PAYMENT_WALLET_LEDGER_SUBMISSION.md (OTP row)
//   no card number / PIN ...... docs/regulatory/TERMS_OF_SERVICE_AND_WALLET_TERMS.md 2.2
//   crash reports scrubbed .... frontend/lib/telemetry.js scrub()
//   maps / geocoding / video .. frontend/lib/mapTiles.js, lib/reverseGeocode.js, components/shop/youtubeEmbed.js (youtube-nocookie)
//   listing views, viewer id .. frontend/hooks/useRecordView.js (ashantihub.viewerId)
//   browser storage keys ...... ashantihub.auth / deviceToken / theme / deliverTo / cookie_consent / guest_token / viewerId
//   no ad or analytics scripts  frontend/index.html (no third-party scripts); the in-page `Analytics` object only keeps events in memory
//   businesses cannot message . root CLAUDE.md "Product rules"
