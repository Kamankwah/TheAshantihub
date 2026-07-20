# Design System — AshantiHub

> Source of truth for AshantiHub's visual language. Created by `/design-consultation`
> (evolve mode) on 2026-07-18. Most of this **documents the system already in code**
> (`frontend/theme.js` `C`, `frontend/components/dashboard/theme.js` `D`,
> `frontend/index.css` shadcn tokens). Items marked **[CHANGE]** are proposed
> evolutions not yet fully implemented; items marked **[PHASE 2]** are documented
> direction, not built. Palette is **unchanged** — the only real change is typography.

## Product Context
- **What this is:** Kumasi's local marketplace — hotels, food, tours, kente crafts, transport, plus an Events tab and business/credit/payments dashboards.
- **Who it's for:** Customers (buyers), Business Owners (sellers), and Staff (moderation/finance/admin).
- **Space/industry:** Local commerce / verified-business marketplace, Ashanti region of Ghana.
- **Project type:** Vite + React web app (PWA-manifested). `App.jsx` monolith + `frontend/components/*`, with a shadcn/Tailwind layer scoped to newer components.
- **Memorable impression (the north star):** **"Proudly Ashanti & trustworthy."** Rich Kumasi/kente identity that also feels safe to transact on — verified real businesses, not a sketchy classifieds board.

## Design Thesis
**A modern Kumasi gold-trader's ledger.** Heritage on the frame — cream canvas, woven
kente edges, Fraunces headings, real Kumasi photography, a sense of place. Sobriety in
the core — Plus Jakarta Sans, aligned figures, one restrained gold on prices, checkout,
KYC and dashboards. The contrast *is* the brand: **proud shell, trustworthy core.**

## Aesthetic Direction
- **Direction:** Editorial / refined heritage.
- **Decoration level:** Intentional. Kente lives on **4–6px structural edges** (global header top-stripe, section dividers, card-hover) and in empty hero space — **never** as a fill or watermark behind content or data.
- **Mood:** Warm, premium, calm, unmistakably Kumasi. Welcoming ("Akwaaba") without being a festival flyer.
- **Reference/technique already in code:** the Ghana-flag stripe (`Navbar`, `BusinessCommandCenter` header), Hero Ken-Burns carousel, `.command-center` warm radial glow.

## Typography  **[CHANGE — the core of this evolution]**
Today there is **no global font**: the customer app leans on the browser-default serif
with stray `Georgia`, while newer shadcn components use `Geist Variable`. Consolidate to
one deliberate pairing across the whole app.

- **Display / Hero / headings & business names:** **Fraunces** (variable, optical-size axis).
  - *Why:* warm, high-contrast editorial serif — premium and hospitable, not cold-Swiss. Craft comes from letterform contrast, **not** a faux-tribal display face (that is the stereotype trap; never use wedge/"jungle"/novelty type).
  - *Tuning:* use the `opsz` axis high and weight 500–600 at display sizes; italic in the accent gold for occasional emphasis (`<em>`).
  - Stack: `'Fraunces', Georgia, 'Times New Roman', serif` (Georgia stays as fallback so nothing degrades ugly).
- **Body / UI / labels / data:** **Plus Jakarta Sans**.
  - *Why:* humanist geometric workhorse with a tall x-height and open apertures — legible at 12–13px in dense grids and tables (a trust requirement). More warmth than Inter/Roboto without fighting Fraunces. Replaces the Geist/Georgia/browser-default split with one system.
  - Stack: `'Plus Jakarta Sans', system-ui, -apple-system, sans-serif`.
  - **Tabular figures required on every number** (`font-feature-settings: "tnum" 1` / `font-variant-numeric: tabular-nums`): prices, credit scores, transaction tables, dashboard KPIs, ticket counts. Ragged numerals look amateur; aligned ones look like money.
- **Data/Tables:** same as body (Plus Jakarta Sans + tabular-nums) — no separate table font.
- **Code / ticket & access codes:** **JetBrains Mono** (`'JetBrains Mono', ui-monospace, monospace`). Pins the currently-unspecified `monospace` used by ticket codes / access codes.
- **Loading:** Google Fonts (or self-host via `@fontsource`) —
  `Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700` +
  `Plus+Jakarta+Sans:wght@400;500;600;700;800` + `JetBrains+Mono:wght@400;500`.
  Note: `index.css` currently `@import`s `@fontsource-variable/geist` — replace with Plus Jakarta Sans and update `--font-sans` in the `@theme` block.
- **Scale (px):** display 48–72 (clamp) · h1 34 · h2 24 · h3 18 · body 16 · small 13 · micro 11 (eyebrow/caps). Body line-height 1.5; heading line-height ~1.05–1.15; heading letter-spacing −0.02em.

## Color  **[UNCHANGED — documenting existing `theme.js` `C`]**
- **Approach:** Balanced-restrained. One gold carries brand + action; kente hues are semantic/categorical only. Cream is the default canvas (not white).
- **Primary / brand / action:** `#D4A017` (gold). Logo, primary CTAs, active nav, focus rings. **One gold** — gold-everywhere reads Vegas.
- **Deep gold (accent):** `#B8860B`. Eyebrows, secondary emphasis, `--accent`.
- **Canvas:** `#FDF6E3` (cream) — the page background everywhere; does most of the "warm Ashanti" work invisibly.
- **Surface (raised cards):** `#FFFFFF`. Recessed well: `#F5ECD8` (`D.panelBg2`).
- **Text:** `#2C1810` (dark brown) on cream — warmer/more premium than pure black. Dim `rgba(44,24,16,0.62)`, faint `rgba(44,24,16,0.42)`.
- **Light gold:** `#F5DEB3` (`--secondary`/`--muted`).
- **Kente / semantic:**
  - `#006400` kente green → **verified / success** (verification's mark).
  - `#CC0000` kente red → **error / destructive** (retune ~10% for dark surfaces: `#e03a3a`).
  - `#000080` kente navy → categorical accent / chart series.
  - `#E8621A` orange (`C.orange`) → **warning / pending**.
- **Chart series (`--chart-1..5`):** gold, green, navy, purple `#6B4E8E`, deep gold/amber. (`#6B4E8E` is the one non-`C` hex — chart variety only, no purple in the brand.)
- **Draft/neutral:** `#8A7A6B` (warm gray, listing "draft" status — the other non-`C` hex).
- **Borders:** gold at low opacity — `#D4A01733` light / `#D4A01740` dark.
- **Dark mode:** already defined in `index.css` `.dark` — page `#160E08` (`C.void`), text `#F5DEB3`, cards `#2C1810`, same gold primary. Toggle lives on the public Navbar only; dashboards are always-light by design.

### Trust-surface color rules (non-negotiable)
- **Prices, totals, checkout amounts:** dark-brown text, tabular figures, **zero decoration**. Money must look like money. Never gold, never on a pattern.
- **Verification badges:** kente-**green** check as the mark, **neutral chrome** (cream/white field, thin border, "Verified business" label). **Never gold** — gold is the brand/promoted color, so a gold "verified" badge blurs *trusted* with *paid-to-be-here*. **Verification and advertising must look different.**
- **Checkout / payment / KYC forms:** near-neutral, cream canvas, white cards, one gold confirm button, generous space. Calm = trustworthy.
- **Never** a kente pattern behind body text, prices, or data tables.

## Spacing
- **Base unit:** 4px.
- **Density:** Comfortable in the marketplace shell; compact in dashboards/tables.
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64).

## Layout
- **Approach:** Hybrid — grid-disciplined for the marketplace grid and dashboards; editorial moments (hero, empty states) may break the grid.
- **Grid:** responsive auto-fill card grid (listings `minmax(240px,1fr)`, KPIs `minmax(160px,1fr)`). Mobile-first (70%+ of marketplace traffic is mobile; the ≤760px breakpoint already drives Navbar/Sidebar collapse).
- **Max content width:** ~1120px.
- **Border radius:** cards/panels 16px, buttons/inputs 10–12px, chips/badges 999px (pill). Matches `D.glassCard` (16) and `--radius: 0.75rem`.
- **Elevation:** soft warm shadow `0 10px 28px rgba(44,24,16,0.12)` (`D.shadow`); card-hover lifts to `0 16px 36px rgba(44,24,16,0.16)`.

## Motion
- **Approach:** Minimal-functional. Keep existing flourishes only (Hero Ken-Burns drift, carousel crossfades, `.command-center` radial glow). No new choreography.
- **Reduced motion:** every animation must respect `prefers-reduced-motion` (already the convention via `usePrefersReducedMotion` / SlideCarousel instant-cut). Card-hover lift ~150ms.
- **Easing:** enter `ease-out`, exit `ease-in`, move `ease-in-out`. **Duration:** micro 50–100ms · short 150–250ms · medium 250–400ms.

## Ownable Pattern — Verified-Tier Kente Band  **[PHASE 2 — documented, not built]**
Turn the anti-classifieds thesis into a visible UI pattern: a small woven strip on each
business card/profile that **deepens with verification level**, filling green → gold as
trust grows. It answers "is this a real Kumasi business?" at a glance.
- **Tiers (map to real backend data):**
  1. **KYC checked** — identity verified (`kyc_status === "verified"`) → 1 green thread.
  2. **Payout verified** — bank/MoMo confirmed (`payout_verified`) → + deep-gold thread.
  3. **Established** — actively transacting (credit-factor tenure/listings) → + gold thread.
- **Rules:** green→gold threads only; **never** used as a promoted/paid signal; neutral chrome; sits on the card edge, not behind content. Distinct from the `📣 Promote` (gold, paid) system so trust and advertising never look alike.

## Anti-Slop Guardrails (African-themed brand)
- No mudcloth/adinkra/kente as full-bleed backgrounds or watermarks — patterns live on ~4–6px edges and intentional empty space only.
- No "safari/sunset-orange gradient" and no faux-tribal display fonts. Warmth comes from cream + gold + Fraunces.
- Kente colors stay muted and structural — never a rainbow chip row. 1–2 accents per surface; let cream and gold carry the identity.
- **Real Kumasi photography only** (Manhyia, Kejetia, real vendors, real looms) — never generic "Africa" stock. Fix dead heritage hotlinks (e.g. `KUMASI_PHOTOS.akwasidae`) rather than leaving them broken.
- Don't ethnically theme the money/admin surfaces — dashboards, checkout, and KYC stay quiet and near-neutral on purpose.
- One gold, one heading serif, tabular numerals, cream canvas — enforced globally. Restraint *is* the premium signal.
- Avoid generic AI slop: no purple gradient heroes, no 3-column icon-in-a-circle grids, no centered-everything, no gradient CTA buttons, no `system-ui` as the display/body star.

## Implementation Notes (where things live)
- `frontend/theme.js` → `C` palette + `CURRENCIES` (single source of truth for inline-styled surfaces).
- `frontend/components/dashboard/theme.js` → `D` (light "artisan" mirror of `C`), `glassCard`, `sectionTitle`, `CHART`, status-meta maps, `ghs()`.
- `frontend/index.css` → shadcn/Tailwind CSS-var tokens (`:root` light, `.dark`, `.command-center`), remapped from generic Nova to `C`. **Keep in sync with `C` by hand** — no automated bridge.
- Two token systems coexist by design: inline-style `C`/`D` (legacy customer + dashboard surfaces) and Tailwind/shadcn (new `components/ui/*.tsx`, `shadcn-scope`-wrapped). The typography change touches both: the global font stacks and `index.css`'s `@theme --font-sans`.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-18 | DESIGN.md created (evolve mode) | Codified the existing `C`/`D`/shadcn system as source of truth; the system existed in code but was undocumented. |
| 2026-07-18 | Palette kept unchanged | Already coherent and correctly separates promotion (gold) from status (kente); a launch-hardening branch is no place to churn color. |
| 2026-07-18 | Typography: Fraunces + Plus Jakarta Sans (retire Geist/Georgia/browser-default) | The real gap — no global font today. One editorial serif + one legible workhorse sans with tabular figures delivers "premium shell, trustworthy core." |
| 2026-07-18 | Verified badge is kente-green + neutral, never gold | Gold is the brand/promoted color; a gold "verified" badge would blur trusted with paid. Verification and advertising must look different. |
| 2026-07-18 | Verified-tier kente band documented as Phase 2 principle | Ownable trust pattern; deferred as net-new component on a hardening branch. |
