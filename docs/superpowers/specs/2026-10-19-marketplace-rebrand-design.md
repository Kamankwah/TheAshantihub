# Marketplace Rebrand and Opening — Design

Date: 2026-10-19. Status: Plans 1-3 are built and merged into `righteoushack` (Plan 1 awaiting staging, gate flag `MARKETPLACE_GATE_ENABLED` off by default; Plans 2 and 3 not deployed). Plan 4 (shopper pages) built on branch `feature/marketplace-4-shopper-pages`, not deployed; later plans not started. Source: owner interview (this session) and the screenshots in `docs/` (`screenshot_amazon_home.png`, `Screenshot_amazon_*`, `Screenshot_main_product_page_*`, `Screenshot_product_preview_*`, `Screenshot_shopping_cart*`, `Screenshot_checkout`, `Screenshot_payment_verification screen`, `Screenshot_user_account_*`). Visual language stays `DESIGN.md` (gold, cream, brown, Fraunces / Plus Jakarta Sans); only the layout and behaviour follow Amazon.

## Intent

AshantiHub is rebranding as a marketplace in the Amazon mould. A visitor who opens the site lands on the marketplace, read-only, under a big countdown to opening day, 6 November 2026 at 06:00 Accra time. Until then the site sells the launch (notify-me, wishlists, accounts) while businesses and staff keep loading and approving stock. The same release reshapes the business tools, the staff listing pipeline and the shopper pages.

## Delivery: four plans, in this order

1. **Opening-day storefront** (must ship before 6 Nov).
2. **Business listing tools and Ashanti Direct.**
3. **Staff listing pipeline** (scouts, Operations, Super Admin; targets; purchase counts).
4. **Product, cart, checkout and account page redesign** (including the shopper wallet pages).

Each plan is written and built separately. The wallet plans 7E, 7C, 7D, 7B (docs/superpowers/plans, 2026-10-18) are separate work and are not changed by this design.

## Goals, non-goals, anti-goals

Goals: Amazon-grade layout and behaviour in AshantiHub's theme; a launch that builds appetite; richer listings (variants, media); staff able to onboard clients; honest discounts.

Non-goals: Twi or any language but English; customer questions-and-answers; gift cards or reward points; paid hero, sponsored or promotion pricing (comes later); AI answers in the chatbot; any direct business-to-customer contact (see CLAUDE.md "Product rules").

Anti-goals: a shopper able to buy before the opening; fake discounts; a staff member approving their own listing; a business listed for a client without that client's confirmation; fabricated data in the UI.

## Plan 1 — Opening-day storefront

**Opening gate.** One opening time, `2026-11-06 06:00 Africa/Accra`, stored as a governed site setting. When reached the marketplace opens by itself. A Super Admin switch can delay it (sets a new opening time). Before opening: browse, search, wishlist, create account and sign in all work for shoppers; the cart, checkout and any buy action are disabled (visible, greyed, with "Opens 6 Nov"), and the server refuses order, checkout and booking creation by shoppers. Businesses and staff are unaffected.

**Landing.** The site's root goes to the marketplace home. Until opening a full-width countdown takeover (days, hours, minutes, seconds, mockup "A") sits on top of the page with a "Notify me" button; after opening the takeover disappears and the hero slider is first. The countdown is computed from the server's opening time (not the device clock).

**Notify me.** A visitor gives a phone number or an email (either is enough); at opening a text and/or email goes to whatever they gave, once. Idempotent, rate-limited, no duplicates, opt-out honoured; text sending uses the existing SMS provider path and must not flood at opening (batched sends).

**Home page (below the takeover):** Amazon-style header with logo, delivery location, search with a category picker (searches products, services, stays and events), Sign in, Wishlist, Cart; secondary nav strip; hero slider; flash banner; Deals; most visited categories; call-to-action block (customized to AshantiHub, in the spirit of `Screenshot_amazon_call_to_action.png`); footer (Support, About us, Contact, as `Screenshot_amazon_footer.png`).

- **Hero slider:** unlimited slides, images and video (direct upload or YouTube link). Created by businesses; approved by Marketing, Operations or Super Admin. A business picks start and end dates; maximum run 30 days. Free until the paid version is built later.
- **Flash banner:** created and published directly by Marketing: promotions, countdowns for promotions and events.
- **Deals:** products with a live discount (any discount qualifies); sponsored products also appear. Discounts go live at once. A struck-through "was" price shows only if the listing really held that price for the previous 7 days, otherwise only the sale price.
- **Most visited categories:** computed automatically from category visits over the last 30 days. (Builder's call: before enough data exists, fall back to seed order.)
- **Footer/Contact:** Contact link goes to a contact page that is a message form only; the contact-details block is removed from that page and nowhere in the footer.

**Themes.** Fix the header light/dark toggle on every page. First visit follows the device's setting.

**Chatbot.** On open it asks name, email and phone, welcomes the person, asks their issue, records it and hands it to Support (no automated answers). Support sees the contact details with the conversation and can call, text, email or reply in the chat. Purpose: stop call flooding; Support works from the queue.

**Categories.** Seed all Amazon.com departments and sub-categories except the digital-content devices (Prime Video, Amazon Music, Kindle E-readers & Books, Amazon Appstore). The existing service, stay and event categories stay alongside. Existing products are mapped from their old product category to a new department automatically (a documented mapping table in the migration).

## Plan 2 — Business listing tools and Ashanti Direct

- **Variants.** A product can have variants (flavour, size, etc.), each with its own price and stock. A shopper can choose several variants with a quantity for each in one purchase.
- **Media.** Per listing up to 9 images (5 MB each) and 2 videos (uploaded: 60 s, 100 MB, converted to a web format; or YouTube links). Images can be added when editing an approved listing.
- **Drop and Discontinue.** In the business dashboard's products and listings: *Drop* hides the product for now and can be reversed; *Discontinue* retires it permanently while old orders still show it.
- **Editing an approved listing.** The approved version stays live while an edit awaits approval. Price and stock changes go live at once; every other change (title, description, media, variants' attributes) needs approval again.
- **Business pages and promotion tools.** Business, product, service and event pages designed to what each offers, with tools to create discounts, hero ads, promotions and sponsored ads (all free until priced).
- **Ashanti Direct.** A normal business owned by the company, run by Operations: its own products, promos and discounts. Same fee, wallet and payout rules as any business, no exemption. Partner businesses remain visible. A "Sold by Ashanti Direct" filter appears in the shopper sidebar and on product pages where applicable.

## Plan 3 — Staff listing pipeline

- **Scout targets.** Replace the `renewals` metric with `listings` (in `targets/models.py` metrics) and count each product, service, event or stay a scout lists for a business, counted only once it is approved. Existing renewals data is kept historically, not deleted. The scout's prospects "pipeline" gains a listings step.
- **Who can list for clients.** Scouts, Operations and Super Admin can add prospects, register businesses and list products, services, events and stays on a client's behalf.
- **Owner confirmation.** Both the registration and the listings need the owner's confirmation through a text message with a link, valid 7 days; after that the draft lapses and can be resent. Nothing goes live without it.
- **Approval.** Listings are approved by Operations, the GM or a Super Admin; never by the person who created or listed it.
  *Built:* the GM is the General Manager role (Plan 3, Task 0), not merely a permission; the permission `listings.approve_staffed` is granted to Operations, Super Admin and the GM. The kind is two-person, so a Super Admin's own listing waits for someone else.
- **Purchase counts.** The Super Admin listings table gains two numbers per product, service or event: how many were paid and how many of those were refunded.

## Plan 4 — Product, cart, checkout and account pages

Redesigned to match the screenshots, in AshantiHub's theme: product page (gallery, hover-zoom with a side pane, click for gallery of images and video with sliding and playback; on phones a tap opens a full-screen gallery with pinch-zoom), variant picker with per-variant quantities, "Customers also viewed" and "Sponsored products" carousels, reviews; no questions-and-answers. Cart, checkout and payment-verification pages follow the screenshots. A GhanaPost digital address (with a map pin and a landmark) is required at checkout because delivery depends on it.

**Your Account** keeps: Your Orders, Login & security, Your Addresses, Your Payments (wallet), Your Lists (wishlist), Your Messages (with Support), Customer Service. It drops Prime, Gift cards, Amazon Family and Digital Services. The "Your business account" tile becomes **Sell on AshantiHub**, letting a shopper start registering a business.

**Shopper wallet** (four tabs, money only, no gift cards or points): *Overview* (balance, Top up, recent activity); *Wallet* (saved mobile money numbers and cards, the default marked, numbers masked to the last digits); *Transactions* (top-ups, purchases, refunds, withdrawals); *Settings* (default address and default payment method). Shoppers can withdraw wallet money to mobile money, under the existing wallet rules (limits, cooling period, top-up hold). The wallet backend exists; this plan builds the shopper-facing screens.

## Constraints

- No direct business-to-customer contact anywhere; Support is the only channel (CLAUDE.md).
- No fabricated data in the UI; empty states say so.
- Staging first; no production promotion without the owner's explicit say.
- Money rules unchanged: Ashanti Direct and all businesses use the existing fee, wallet and payout rules.

## Left to the builder

Visual details inside the documented screenshots; mapping table from old product categories to the new departments; the exact opening-gate mechanics (a governed setting plus a server-side check); batching of opening-day texts; the video-conversion tool; what the call-to-action block says.

## Decisions from the builder check

Owner's answers:
- **Departments:** shoppers browsing and filtering see only departments and categories that currently have listings; when a business *lists* (creates a listing) it sees the full department and category tree.
- **Opening texts:** the sender name comes from the SMS provider; texts go out in batches (the sender name and any volume cap are set up with the provider before 6 Nov).

Builder's calls (the owner may overrule):
- **Pre-opening gate:** "shopper" means a customer account. Staff and business accounts are exempt. A Super Admin can add named test accounts to an allowlist so the full purchase flow can be tested on staging and production before 6 Nov.
- **Shopper wallet screens (Plan 4):** show only what exists in the backend today: wallet balance, transactions, withdrawals and saved mobile money numbers. Saved cards and a default payment method wait until payments are real (CLAUDE.md: no payment-method model). Plan 4 depends on the shopper wallet screens, not on wallet plans 7B–7E.
- **Discounts:** a discount is a sale price on the listing. Price history is recorded from now, so "was" prices appear about 7 days after launch. "Sponsored" items in Plan 1 are products Marketing or Operations flag as featured; paid sponsorship comes later.
- **Chatbot:** reuses the existing messaging conversations, with no business attached. A business owner who opens it is still handled by Support only.
- **Hero slider:** business hero-ad submission belongs in Plan 1; Marketing adds the day-one slides.
- **Owner confirmation link:** the system texts the link, so the scout never sees it; staff approval still follows and the approver sees the number the link went to.

Decisions recorded at launch (Plan M1B):
- **Category mapping:** confirmed as built.
- **Hero video:** 25 MB cap for launch.
- **Notify-me SMS:** the text reads "AshantiHub is open! Shop now: <FRONTEND_BASE_URL host>". There is no stop link in the SMS; opt-out is by the link in the email. When `FRONTEND_BASE_URL` is unset or localhost, the host falls back to theashantihub.com.
- **Fonts:** self-hosted via @fontsource (Fraunces, Plus Jakarta Sans, JetBrains Mono); no Google hosts.
- **Business contact phone:** removed from all public responses; the owner and staff keep it.
- **Dark mode:** on every page via the `--ah-*` tokens. The listing and event detail pages remain fixed-dark in both themes; the owner may want a light variant.
- **AshantiHub's own support contacts:** unchanged.

Decisions recorded for Plan 2 (business listing tools):
- **V5, what is live at once:** `manage` is narrowed to `price_amount`, `price_unit` and stock. Everything else, including `tag`, `contact_phone`, `specs`, `service_duration` and the warranty/expiry/return/brand/condition/dimensions/weight/barcode fields, goes through a pending revision. R2: `sale_price` stays live like price.
- **B1:** the 9 images include the main photo. **B2:** `contact_phone` and the decision fields need re-approval, although today they do not. **B3:** Ashanti Direct hero ads are Marketing's own slides; Operations does not submit them. **B4:** a discount's end date is optional, 1% to 90% off, one live discount per listing or variant. **B5:** a listing with variants cannot join a flash sale.
- **`contact_phone`:** stays hidden from the public (Plan 1); owner and staff see it, and changing it needs staff approval.
- **Discount design (R6/R29):** no `ListingDiscount` model. A discount is `sale_price` + `sale_ends_at` + `sale_started_at` on the listing and on each variant; "was" shows only after the regular price stood 7 days before the sale began.
- **R19:** variants only on goods and food. **R22:** nginx API body limit raised from 25m to 110m so the 100 MB video reaches the app. **R24:** staff see every video before it goes public; submit is refused while one is converting. **R32:** maker-checker for Direct blocks every staff member who drafted, edited or submitted the item, not only the creator.
- **Owner supplies before staging:** `ASHANTI_DIRECT_PHONE` and `ASHANTI_DIRECT_EMAIL` (no defaults; `ensure_ashanti_direct` refuses without them); a Super Admin sets Direct's password and payout details.

Decisions recorded for Plan 4 (shopper pages):
- **GhanaPost:** required for door-to-door delivery only (Ashanti codes, plus a landmark); store pickup needs neither. Builder's call; the owner may overrule.
- **Payment methods:** payout numbers are not payment methods. There is no default payment method and no saved cards; saved mobile-money numbers are withdrawal destinations, labelled so.
- **Your Orders** carries the Bookings, Service requests, Tickets and My events tabs so no existing feature is lost.
- **"Customers also viewed"** shows only on real co-views (3 co-viewers per row, at least 4 rows); otherwise the carousel reads "More in this category".
- **Product page** is themed (light and dark), unlike the fixed-dark service and stay pages.
- **Questions-and-answers** removed from listing pages; event Q&A is untouched (owner follow-up).
- **Amounts** in the cart, checkout and verify pages are always GHS (what is charged); there are no delivery dates (no ETA source).
- **Owner checks on staging:** each new page at 360, 768 and 1280 px for horizontal overflow plus a `DESIGN.md` pass (gold only on actions, cream canvas, Fraunces headings, tabular figures); the product gallery's pinch-zoom and swipe gestures on a real phone.
