# Live-Action Shoot Package — Design

**Date:** 2026-10-05
**Status:** Approved design, not yet implemented
**Supersedes:** the screen-led approach in `docs/marketing/shoot-package.md` (App, Gap and
Graphic rows) and the three screen-led Remotion clips (retired, not published)

## 1. Goal

Every AshantiHub marketing video is made of real scenes: real people, real places in Kumasi and
Bonwire, filmed by a small hired crew. Screen-recorded phone scrolling and illustrated or
composited UI are gone. The app appears only as a short phone insert, filmed in camera, where the
words on screen carry a claim.

### Decisions already made (with the user)

| Question | Decision |
| --- | --- |
| Real or generated | **Filmed for real.** No AI-generated people or places (DESIGN.md: *real Kumasi photography only*). |
| Deliverables | The two 60–90s promos, the six 30–45s social clips, and still photography. |
| App moments | **People-first, plus phone inserts.** App beats become real-world scenes; an in-camera insert of the real app only where the on-screen words carry the claim. |
| Who is on camera | **Mix.** Real AshantiHub businesses appear as themselves in the work scenes. The storyline business whose dashboard is shown is a Bonwire weaver portraying the fictional *Akosua Ntoma* demo store. A Kejetia trader (talent) portrays a second demo store for the sign-up beats. |
| Crew | A small hired Kumasi crew (camera operator with mirrorless + gimbal + lav mics + basic lights, a producer for releases, optional sound person). |
| Social-clip presenter | **One recurring host**, Twi-fluent talent under release, fronting all six clips. |
| Shoot structure | **Shoot by location, cut by video:** each location visit captures every beat, clip and still that lives there. Three days plus pickups. |
| Screen-led Remotion clips | **Retired.** Not published; kept only in the local `marketing/` workspace as reference. |
| Voiceover | The host records all VO (promos and clips). ElevenLabs VO only as a scratch track for the rough cut. |
| Music | **ElevenLabs instrumental highlife beds**, generated to the final cut lengths. |
| The "× 47" hook | Kept: rhetorical, not a statistic. |

### Scope

**In scope (this change):**
- rewriting the *Visual / on-screen text* column of every row in `docs/marketing/business-script.md`
  and `docs/marketing/customer-script.md` (both promos, all six clips) as real scenes
- rewriting `docs/marketing/shoot-package.md` around location-ordered setups (structure in §3)
- updating both scripts' *Production notes* so they no longer describe screen recordings

**Out of scope (follow-ups, listed in §11):**
- creating the staging demo data the phone inserts need (§9)
- swapping the website's hotlinked photos for the new stills
- hiring the crew, the shoot itself, the edit, and generating the final music beds

## 2. Where each piece of information lives

One source per fact, so the scripts and the package cannot drift:

- **The scripts say what each beat shows.** The *Visual / on-screen text* column is the
  storyboard for each video. The voiceover column stays as written unless a new scene forces a
  change; any such change is listed in the commit message.
- **The shoot package says how and where each beat is captured.** It is organised by location and
  setup. A **setup** is one camera position at one location. Every setup lists the beats and stills
  it serves, using these IDs:

  | ID | Video |
  | --- | --- |
  | `CP` | Customer promo (60–90s) |
  | `BP` | Business promo (60–90s) |
  | `CC1` `CC2` `CC3` | Customer clips 1–3 (trust · diaspora · "Why can't I WhatsApp the seller?") |
  | `BC1` `BC2` `BC3` | Business clips 1–3 ("GHS 0 to join" · credit · "Is this still available?") |
  | `S01`… | Stills |

  A beat is referenced as video + script time, e.g. `BP 0–6s`, `BC3 hook`.

## 3. Shoot package structure

`docs/marketing/shoot-package.md` is rewritten with these sections, in this order:

1. **Summary** — deliverables (16 video masters + stills), crew, shoot days.
2. **Content rules** — §7 of this spec.
3. **Cast** — §5.
4. **Locations and permissions** — every location with the permission it needs (§7).
5. **Call sheet** — the three days and pickups, in time order (§6).
6. **Setups by location** — one table per location. Columns: `Setup` · `Subject / action` ·
   `Framing & movement` · `Serves` (beat and still IDs) · `Capture` (duration × takes) · `Crops`
   (`Both` = separate vertical take, `Centre-safe` = 16:9 with the subject in the centre third).
7. **Phone-insert protocol** — §4.
8. **Staging prep for phone inserts** — §9 (replaces *App screens still to capture*).
9. **Stills shot list** — §8.
10. **B-roll** — kept from the current package, extended for the new locations.
11. **Audio** — natural sound and room tone as now, plus **sync sound for the host**: lav plus a
    backup recorder, and a 45-minute VO recording block on Day 3.
12. **Release-form checklist** — §7.
13. **Post-production** — §10.
14. **Delivery spec** — kept from the current package (30 fps, 4K preferred, 1/50 or 1/100
    indoors, file naming).

## 4. Turning app beats into real scenes

**The rule:** every beat is a real person doing a real thing in a real place. The app appears only
as a phone insert filmed in camera, and only where the words on screen carry the claim. No
composited, mocked-up or animated UI. The only graphics are text supers and the logo end card.

### 4.1 Conversions for every beat that used an app screen or a graphic

| Beat | Was | Becomes |
| --- | --- | --- |
| `CP 6–15s` | Scrolling a social-media sale post; chat marked "seen" | The viewer at home frowning at a phone whose screen faces away. VO carries it. No mock-up of a third-party app. |
| `CP 15–26s` | Logo resolves, app opens; chips *Ghana Card · Digital address · Physical check* | A real AshantiHub scout visits a shop, checks the GhanaPost GPS plate against the signboard, talks with the owner. Insert: the staff app marking the business **✓ Visited**. The chips become a text super. No Ghana Card is ever legible. |
| `CP 26–38s` | Quick cuts of app screens: kente to cart · hair booking · ticket | The demo customer at home adds the kente stole to cart (insert: cart) · a braider at work in the salon (insert: a booking confirmation from the demo service business) · the demo customer and friends walking up to the real event's gate (insert: the real ticket). |
| `CP 38–50s` | Support chat screen | Rider scene unchanged. Insert: the customer's phone showing *AshantiHub Support · Re: Handwoven kente stole*. |
| `CP 50–64s` | Review, QR scan, dispute screens | Insert: a review with a *Verified Purchase* tag · the QR scan filmed live at a real AshantiHub-listed event: the demo customer holds a real ticket bought on production and is checked in for real (pickup) · a Support agent at a desk reviewing a dispute (insert: the dispute). |
| `BP 6–14s` | A phone search where her business isn't there (built in the edit) | Akosua at her stall while foot traffic walks past. VO carries it. The bank line stays VO-only. |
| `BP 14–25s` | Storefront builds itself on screen | Akosua photographs a finished kente strip in her shop. Insert: her storefront. No rating shown until a real verified review exists (§9). |
| `BP 25–38s` | Notifications stack up | Her phone buzzes on the loom bench; she glances at it. Insert: the real staging Order #1. *Take bookings* and *sell tickets* become quick live cuts of the braider with a client and an event gate, under the super *Sell · Take bookings · Sell tickets* (a weaver doesn't take bookings, so no booking or ticket inserts on her phone). Rider loading a parcel unchanged. |
| `BP 38–48s` | Support agent, screen insert | Unchanged (live), with the insert filmed in camera on the agent's laptop or phone. |
| `BP 48–60s` | Dashboard with a Credit Score dial climbing | Insert: the real current score and *lending partners coming soon*, as the app shows them. No animated climb. |
| `BP 60–70s` | Her shop in the homepage Hero (screen) | A customer at a café laptop on the homepage, with a staff-approved Hero placement of the demo store. Laptop fullscreen. |
| `BP 70–80s` | Sign-up screen | A Kejetia trader (talent) signing up on a phone at the stall. Insert: the plan step with *Your first billing cycle is FREE*. |
| `BC1` | Host with empty wallet; screen recording of registration; storefront and first order | Host at the Kejetia trader's stall holding an empty wallet, to camera · the trader registers with the host alongside (inserts: account → business details → plan, on the second demo store's staging account, test identity data) · inserts: the storefront live, its first order. |
| `BC2` | Loan form; market montage; dashboard | At Bonwire: host with Akosua holding a generic loan form, *Financial records* circled in red (prop: no bank name or logo) · the Kejetia stall montage from Day 1, cash changing hands · insert: Akosua's Credit Score with *lending partners coming soon*. |
| `BC3` | A phone buzzing with the same message; Support handles it; dashboard | At Bonwire: Akosua's phone buzzing on the loom bench, screen unreadable; super *"Is this still available?" × 47*; host hook to camera · she turns it face-down and weaves · Support agent handles it (live + insert) · insert: her orders in the dashboard; a quick live cut of the braider with a client for *book*; rider. |
| `CC1` | "Pay first, I'll send it" message close-up; scrolling listings; checkout; dispute button | Host reads a message aloud with an eye-roll, screen facing away; super *Pay first?? 🚩* · scout visit footage + insert of a verified listing · inserts: checkout, then *Raise a dispute*. |
| `CC2` | Kotoka arrivals board; quick app cuts; QR scan | Host at **Prempeh I Airport** (Kumasi) arrivals · barber, braider, caterer (chop bar) and kente cloth, each live; two inserts: a booking with the demo service business and the kente stole in the cart · the real-event QR scan from `CP 50–64s` (pickup). |
| `CC3` | Creator to camera; Contact Support tap; chat; cart | Host to camera, mock-confused · the demo customer taps *🎧 Contact Support* (insert) · the Support agent replies (live + insert) · insert: added to cart. |

Every row not listed here is already live action or the end card and is unchanged.

## 5. Cast

| Role | Who | Appears in |
| --- | --- | --- |
| Host | Talent: warm, Twi-fluent | All six clip hooks; all VO |
| "Akosua" | A real Bonwire weaver portraying the fictional demo store (must genuinely weave) | `BP`, `BC2`, `BC3`, stills |
| Real businesses, as themselves | A Suame mechanic, a chop-bar cook (caterer), a braider, a barber, an event organiser; ideally all listed on AshantiHub | `BP 0–6s`, `CP 26–38s`, `CC2`, stills |
| Scout | A real AshantiHub scout | `CP 15–26s`, `CC1` |
| Support agent | A real AshantiHub Support staffer | `CP`, `BP`, `BC3`, `CC3` |
| Demo customer | Talent; also buys a real ticket on production for the real-event pickup | `CP`, `CC2`, `CC3` |
| Kejetia trader | Talent portraying a **second demo store** (named when it is created on staging) | `BP 70–80s`, `BC1` |
| Delivery rider | A real rider | `CP 38–50s`, `BP 25–38s`, `BC3` |
| Family | A real Kumasi family | `CP 64–76s` |
| Diaspora talent | Self-films abroad from a brief | `CP 64–76s` |

Before filming, swap any example category (barber, braider, caterer, fabric) for one actually
listed on the site, as the customer script already requires.

## 6. Shoot days

| Day | Where (in order) | Captures |
| --- | --- | --- |
| **1 — Kumasi city** | Kejetia rooftop at dawn → Kejetia / Adum stalls → Suame Magazine → chop bar → braider's salon and a barbershop → a residential gate → a family home at dusk | Market aerial (`CP 0–6s`); host hooks for `CC1` and `BC1` with the trader; the trader signing up (`BP 70–80s`); stall montage with cash changing hands (`BC2`); trades montage (`BP 0–6s`); service scenes (`CP 26–38s`, `BP 25–38s`, `BC3`, `CC2`); rider at the gate (`CP 38–50s`); family half of the diaspora split; stills |
| **2 — Bonwire** | A courtesy visit to the chief first, then Akosua's loom and shop | Weaving beats across `BP`; the scout's visit; host hooks for `BC2` (loan form) and `BC3` ("× 47"); Akosua photographing kente; rider loading a parcel; the closing smile; stills, including the website's kente slot |
| **3 — Office + Kumasi** | AshantiHub office → a real apartment → a café → Prempeh I Airport | Support agent scenes; every phone insert (controlled light); the host's VO recording; `CC3` hook; demo customer at home; the Hero on a laptop; `CC2` arrivals |
| **Pickups** | A real AshantiHub-listed event · remote · Manhyia on an Akwasidae day · a consenting listed hotel | QR scan at the gate · diaspora half of the split · Akwasidae and palace stills · the hotel still |

The full call sheet in the package gives times per location; Day 1 is the tightest, so the
barbershop and salon are adjacent setups and the rooftop starts at 06:30.

## 7. Releases, permissions and on-set rules

### 7.1 Releases

- **Host:** a paid talent release covering AshantiHub web and social video ads, with a stated
  term of use.
- **Akosua:** a portrayal release stating she plays the fictional *Akosua Ntoma* demo store.
- **Real businesses:** a personal release plus the business's consent to show its premises, name
  and signboard. Its own storefront appears in an insert only with explicit consent. **Its orders,
  revenue or credit figures never appear.**
- **Staff, rider, customer, trader, family, diaspora talent:** each signs a release. Guardian
  consent for anyone under 18. Riders' plates kept out of shot unless consented.
- **Crowds:** faces incidental or out of focus. Ghana's Data Protection Act, 2012 (Act 843)
  expects consent for identifiable people used commercially.
- Scans of every release saved with the footage and logged (name · setup · date · contact).

### 7.2 Permissions

| From | For |
| --- | --- |
| Kumasi Metropolitan Assembly | Filming at Kejetia |
| GCAA | A drone, if used (otherwise the rooftop setup) |
| Ghana Airports Company | Prempeh I Airport arrivals |
| Manhyia Palace | Palace exterior and Akwasidae stills |
| Bonwire chief and elders | Filming in the village (courtesy visit before Day 2) |
| Event organiser | The QR scan pickup |
| Each property owner | Shops, chop bar, salon, barbershop, apartment, café |

### 7.3 On-set rules

Carried over unchanged from the current package:
- Real Kumasi footage only: no stock, no AI-generated people or places.
- No direct contact with businesses: nobody WhatsApp-ing, calling or chatting with a seller.
- No payment brands, no app-store buttons or "download the app", no invented numbers.
- Lending partners only ever "coming soon".

New:
- **Frame out third-party branding.** MTN MoMo kiosks, bank logos and telecom signboards are
  everywhere at Kejetia. Reframe or move rather than blur.
- **No real identity data on screen.** No legible Ghana Card, no real phone numbers, no real
  customers' names in inserts. Demo data only.
- **Demo stores are labelled as portrayals.** A *Demo store* super on every insert showing a
  demo store. The end card of every video that shows one carries one line of fine print per demo
  store in it: *"Akosua Ntoma is a demonstration store, portrayed by a Bonwire weaver."*, and the
  same form, with the name it has on staging, for each other demo store (the Kejetia trader's
  store, the demo service business). All eight videos show at least one demo store, so every end
  card carries fine print.

## 8. Stills

About 20 setups, shot alongside the video by the same crew:

- **Website slots** that `frontend/App.jsx` (`KUMASI_PHOTOS`) currently hotlinks from third-party
  sites: Manhyia Palace, Kejetia market, kente weaving, Akwasidae, Suame, a hotel, a chop bar, a
  Kumasi aerial. Akwasidae is a dated pickup (festival day, palace permission). The hotel needs a
  real hotel listed on AshantiHub that consents.
- **Poster and thumbnail portraits:** the host and Akosua, each with room left for headline text,
  in 16:9, 4:5 and 9:16.
- **WhatsApp Status frames:** 9:16.
- **One image per headline line** in `business-script.md` (*Let the world find you*, *Less
  chasing. More selling.*, …).

Delivered as full-resolution JPEG plus RAW, with releases logged per frame.

## 9. Staging prep for phone inserts

The inserts show the real app, so these must exist on staging before Day 3, created the same way
as the existing demo data (`seed_demo.py` and real flows). Every insert showing the demo store
carries the *Demo store* super.

| Needed for | On staging |
| --- | --- |
| `CP 26–38s`, `CC2` | A demo service business + listing, booked by the demo customer |
| `CP 50–64s`, `BP 14–25s` | A real review by the demo customer on Order #1, approved through moderation |
| `CP 50–64s`, `CC1` | A dispute raised by the demo customer on a demo order |
| `BP 60–70s` | A Hero submission by Akosua Ntoma, approved by staff |
| `CP 15–26s`, `CC1` | A scout assignment for a demo business, ready to mark **Visited** on camera |
| `BC1`, `BP 70–80s` | A throwaway business account for the registration inserts (stopped before submitting), with test identity data |
| `BC1` | The second demo store: approved, one listing, one demo order from the demo customer |

**On production, with consent (not staging):** the demo customer buys a real ticket for a real
AshantiHub-listed event, and the organiser checks that ticket in at the gate for `CP 26–38s`,
`CP 50–64s` and `CC2`. The organiser consents to the gate and their check-in screen being filmed.

**Insert protocol:**
- One clean phone per character, no case, the same handset in that character's scenes and
  inserts. Notifications silenced, brightness matched to the scene, shutter 1/50 to avoid
  flicker. Hold each insert 2–3s; keep it centre-safe for the 9:16 crop.
- The hands in an insert are that character's own, in the same sleeve as their scenes, so
  Akosua, the Kejetia trader, the scout and the demo customer attend Day 3 for their inserts.
- The app runs as the installed PWA, so no browser bar shows `test.theashantihub.com`. The
  laptop runs the browser fullscreen.
- Demo-store and demo-customer inserts use the staging demo accounts. Real-business inserts use
  production, with consent.
- If an insert is unreadable, reshoot it. Never replace a screen in post.

## 10. Post-production

- **Voiceover:** the host records every line in a quiet room at the office on Day 3, on the lav
  plus a backup recorder. Before then, the editor rough-cuts against a scratch VO generated with
  the local ElevenLabs tooling in `marketing/video/`.
- **Music:** ElevenLabs instrumental highlife beds, generated to each final cut's length (one per
  promo, one per clip). Confirm before publishing that the ElevenLabs plan's terms allow
  commercial use of Eleven Music output.
- **Edit:** the crew's editor in Resolve or Premiere on 30 fps timelines. The package gives a
  style sheet: Fraunces for headings, Plus Jakarta Sans for supers, gold on deep brown, the
  kente-edge end card (palette and fonts from DESIGN.md), with supers kept centre-safe and, in
  9:16, clear of the bands where Reels, TikTok and Shorts overlay their own controls. The existing end card
  is supplied as a reference render. The Remotion project is not part of the live-action edit.
- **Masters:** 16 MP4s: 2 promos and 6 clips, each in 16:9 and 9:16. H.264, captions burned in,
  mixed to −14 LUFS integrated with true peaks at or below −1 dBTP. Plus an SRT per video for
  YouTube and the web, and thumbnails from the stills.
- **Review gate:** each rough cut is checked before it is finalised:
  - every claim matches what the app does today
  - *Demo store* supers and the end-card fine print are present
  - no third-party logos in frame
  - every identifiable face has a logged release

  Nothing is published until the checklist passes.

## 11. Follow-ups (separate tasks)

1. Create the staging data in §9.
2. Swap `KUMASI_PHOTOS` hotlinks for the new owned stills once delivered.
3. Generate the music beds and scratch VO once the rough cut fixes each video's length.
4. Update `staging-demo-data` notes when §9 lands.

## 12. Acceptance criteria for this change

- No row of either script's *Visual / on-screen text* column describes a screen recording,
  scrolling, an animated UI or a composited graphic. The only graphics are text supers and the
  logo end card.
- Every app moment in the scripts is either a real-world scene or an in-camera phone insert, and
  every insert's content is listed in §9 or already exists on staging.
- Every beat of all eight videos maps to at least one setup in the shoot package, and every
  setup serves at least one beat or still.
- The shoot package contains no *App*, *Gap* or *Graphic* row types and no reference to
  `marketing/video/public/screens/` or `marketing/video/captions/`.
- Every VO change is listed in the commit message, with its reason.
- The honesty rules in both scripts' *Production notes* still hold.
