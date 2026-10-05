# AshantiHub — Shoot Package (live action)

What a small Kumasi crew needs to film every AshantiHub video and still for real: the two
60–90s promos and the six 30–45s social clips in [`customer-script.md`](customer-script.md) and
[`business-script.md`](business-script.md), plus the stills. The scripts say what each beat
shows; this package says where and how each one is captured. The design behind it is
[`2026-10-05-live-action-shoot-package-design.md`](../superpowers/specs/2026-10-05-live-action-shoot-package-design.md).

After editing the scripts or this package, run `node docs/marketing/check-shoot-package.mjs`. It
checks that every beat is captured by a setup, every setup is on the call sheet, and the scripts
describe no screen recordings or invented figures.

---

## Summary

| | |
|---|---|
| **Deliverables** | 16 video masters: the customer and business promos (about 88s each) and six social clips (30–40s), each cut 16:9 (web) and 9:16 (iOS / Android social). 21 stills. |
| **Approach** | Everything is filmed. App moments are real-world scenes, plus short phone inserts filmed in camera where the words on screen carry the claim. No screen recordings, no scrolling, no composited or illustrated UI. |
| **Crew** | 1 camera operator (mirrorless, gimbal, lav mics, basic lights), 1 producer (releases, permissions, call sheet), optional 1 sound person |
| **Shoot days** | 3 days (Kumasi city · Bonwire · office and Kumasi), plus pickups: a real event, a remote diaspora self-shoot, Manhyia, a hotel |
| **Beat names** | `CP` / `BP` = customer / business promo. `CC1`–`CC3` / `BC1`–`BC3` = customer / business clips 1–3. A beat is the video plus its script time, or `hook` / `cta` for a clip's first and last beat: `BP 0–6s`, `BC3 hook`. `S01`… are stills. |
| **Setup names** | A setup is one camera position at one location: `<location code>-<number>`, e.g. `BW-04`. Codes are in *Locations and permissions*. |

---

## Content rules (non-negotiable)

- **Real footage only.** Real places, real people, real work in Kumasi and Bonwire. No stock
  footage and no AI-generated people or places (DESIGN.md: *real Kumasi photography only*).
- **No direct contact with businesses.** Never show anyone WhatsApp-ing, calling or chatting with
  a seller. Enquiries go to AshantiHub Support.
- **No payment brands** (Mobile Money, Hubtel, card logos), **no app-store buttons or "download
  the app"**, and no third-party platform branding on any screen or signboard in shot.
- **Frame out third-party branding.** MTN MoMo kiosks, bank logos and telecom signboards are
  everywhere at Kejetia. Reframe or move rather than blur.
- **No invented numbers.** Prices only as in the scripts: "plans from GHS 10/month", "first
  billing cycle free". Lending partners are only ever "coming soon". Counts on screen come from
  real staging data, never typed in.
- **No real identity data on screen.** No legible Ghana Card, no real phone numbers, no real
  customers' names in inserts. Demo data only.
- **Demo stores are labelled as portrayals.** A *Demo store* super on every insert showing a demo
  store. Every end card carries one line of fine print per demo store in that video:
  *"Akosua Ntoma is a demonstration store, portrayed by a Bonwire weaver."*, and the same form,
  with the name it has on staging, for the Kejetia trader's store and the demo service business.
- **Real businesses appear as themselves, with permission.** Their own storefront appears in an
  insert only with explicit consent. Their orders, revenue or credit figures never appear.

---

## Cast

| Role | Who | Days | Appears in |
|---|---|---|---|
| Host | Talent: warm, Twi-fluent. Fronts all six clip hooks and voices every promo and clip | 1, 2, 3 | `CC1`–`CC3`, `BC1`–`BC3`; all VO |
| "Akosua" | A real Bonwire weaver portraying the fictional *Akosua Ntoma* demo store. Must genuinely weave | 2, 3 | `BP`, `BC2`, `BC3`, `CP`, `CC1`, stills |
| Kejetia trader | Talent portraying a second demo store (named when it is created on staging) | 1, 3 | `BP 70–80s`, `BC1`, `BC2 3–18s` |
| Demo customer | Talent. Also buys a real ticket on production for the event pickup | 3, pickup | `CP`, `CC1`–`CC3`, `BP 60–70s` |
| Scout | A real AshantiHub scout | 2, 3 | `CP 15–26s`, `CC1 3–20s` |
| Support agent | A real AshantiHub Support staffer | 3 | `BP 38–48s`, `BC3 3–20s`, `CP 50–64s`, `CC3 22–34s` |
| Real businesses, as themselves | A Suame mechanic, a chop-bar cook, a braider, a barber, an event organiser; ideally all listed on AshantiHub | 1, pickup | `BP 0–6s`, `BP 25–38s`, `BC3 20–32s`, `CP 26–38s`, `CC2` |
| Delivery rider | A real rider | 1, 2 | `CP 38–50s`, `BP 25–38s`, `BC3 20–32s` |
| Family | A real Kumasi family | 1 | `CP 64–76s` |
| Diaspora talent | Self-films abroad from a brief | Remote | `CP 64–76s` |
| Friends at the event | Extras, each under release | Pickup | `CP 26–38s` |

Before filming, swap any example category (barber, braider, caterer, fabric) for one actually
listed on the site, as the customer script requires.

---

## Locations and permissions

| Code | Location | Day | Permission needed |
|---|---|---|---|
| KJ | Kejetia: a high rooftop, and a trader's stall at Kejetia or Adum | 1 | Kumasi Metropolitan Assembly filming permission; the rooftop owner's property release; a GCAA permit only if a drone is used |
| SU | A Suame Magazine workshop | 1 | Workshop owner's property release |
| CB | A chop bar | 1 | Owner's property release |
| SL | A braider's salon and an adjacent barbershop | 1 | Property releases from both |
| GT | A residential gate (Ahodwo or Santasi) | 1 | Homeowner's property release |
| FH | A family home in Kumasi | 1 | Homeowner's property release |
| BW | Bonwire: Akosua's loom, stall and shop | 2 | A courtesy visit to the Bonwire chief and elders before filming; the owner's property release |
| OF | The AshantiHub office | 3 | — |
| AP | An apartment in Kumasi | 3 | Owner's property release |
| CF | A café in Kumasi | 3 | Owner's property release |
| AR | Prempeh I Airport arrivals hall | 3 | Ghana Airports Company permission |
| EV | A real AshantiHub-listed event | Pickup | The organiser's permission |
| RM | Remote: the diaspora talent abroad | Pickup | Talent release (self-shot) |
| MH | Manhyia Palace | Pickup | Manhyia Palace permission |
| HT | A hotel listed on AshantiHub | Pickup | The hotel's consent and property release |

---

## Call sheet

### Day 1 — Kumasi city

| Time | Location | Setups | On call |
|---|---|---|---|
| 06:00–07:45 | KJ rooftop (crew call 06:00, first shot 06:30) | KJ-01 | Crew |
| 08:00–10:00 | KJ trader's stall | KJ-02, KJ-04, KJ-03, KJ-05, KJ-06 | Host, Kejetia trader |
| 10:30–11:45 | SU | SU-01 | The mechanic |
| 12:15–13:30 | CB (lunch on location) | CB-01, CB-02 | The cook |
| 14:00–15:30 | SL | SL-01, SL-02 | The braider and a client, the barber |
| 16:00–16:45 | GT | GT-01 | Rider |
| 17:15–18:15 | FH | FH-01 | The family |

### Day 2 — Bonwire

| Time | Location | Setups | On call |
|---|---|---|---|
| 06:45 | Leave Kumasi (allow an hour) | — | Crew, host, scout, rider |
| 08:00–08:30 | Courtesy visit to the chief and elders, arranged by the producer in advance | — | Producer |
| 08:30–10:30 | BW loom | BW-01, BW-06, BW-04, BW-07, BW-08 | Akosua |
| 10:30–11:30 | BW stall and shop | BW-02, BW-03, BW-13 | Akosua |
| 11:30–12:30 | BW loom | BW-09, BW-10 | Host, Akosua |
| 13:15–14:30 | BW shop door | BW-11, BW-12 | Scout, Akosua |
| 14:30–15:15 | BW outside the shop | BW-05 | Rider |
| 15:15–16:30 | Bonwire B-roll, then back to Kumasi | — | Crew |

### Day 3 — Office and Kumasi

| Time | Location | Setups | On call |
|---|---|---|---|
| 08:00–11:00 | OF | OF-01, OF-02, OF-03, OF-04, OF-05, OF-06 | Support agent; Akosua, the Kejetia trader, the scout and the demo customer for their own inserts, in the same sleeves as their scenes |
| 11:00–11:45 | OF, a quiet room | Host VO recording (see *Audio*) | Host |
| 12:30–14:30 | AP | AP-01, AP-02, AP-03 | Demo customer, host |
| 15:00–16:00 | CF | CF-01, CF-02 | Demo customer |
| 16:30–17:30 | AR (the slot agreed with Ghana Airports Company) | AR-01 | Host |

### Pickups

| When | Location | Setups | On call |
|---|---|---|---|
| The date of the chosen AshantiHub-listed event | EV | EV-01, EV-02, EV-03, EV-04 | Demo customer and friends; the organiser |
| Any time before the edit | RM | RM-01 | Diaspora talent (brief and release sent in advance) |
| An Akwasidae day (the exterior any day) | MH | MH-01, MH-02 | Camera operator, producer |
| When a listed hotel consents | HT | HT-01 | Camera operator |

---

## Setups by location

`Both` = shoot a separate vertical take. `Centre-safe` = shoot 16:9 and keep the subject inside
the centre third (the 9:16 crop of a 16:9 frame is its middle 31.6%). `Vertical` = shoot 9:16 only.

### KJ — Kejetia and Adum (Day 1)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| KJ-01 | Kejetia from a high rooftop at dawn: the market waking, traffic, stalls; a wider frame across the city | Wide, slow push-in or slow pan right; locked-off alternative. Drone only with a GCAA permit | `CP 0–6s`, `S02`, `S08` | 20s × 3 | Both (vertical take: tilt down over the stalls) |
| KJ-02 | Host at a busy stall reads a message aloud from a phone, screen facing away, then an eye-roll to camera; then a portrait with room for a headline | Medium close, eye-level, host centred; stall life behind, faces incidental | `CC1 hook`, `S09` | 15s × 5 | Both |
| KJ-03 | The Kejetia trader signs up on a phone at the stall. Take A alone; take B with the host alongside | Medium, then close on hands. The screen is not legible here; its inserts are OF-04 | `BP 70–80s`, `BC1 3–20s` | 20s × 3 per take | Both |
| KJ-04 | Host at the trader's stall holds up an empty wallet, grinning, to camera | Medium close, host centred | `BC1 hook` | 15s × 5 | Both |
| KJ-05 | The trader's phone lights up; a smile at it | Over-the-shoulder, then reverse on the face | `BC1 20–32s`, `S16` | 15s × 3 | Both |
| KJ-06 | Stall montage: goods handed over, cash changing hands, nothing written down | Tight details on hands and goods, handheld; buyers' faces out of frame or out of focus | `BC2 3–18s`, `S12` | 10s × 6 details | Both |

### SU — Suame Magazine (Day 1)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| SU-01 | A Suame mechanic, as themselves, working under a bonnet; tools on the bench | Low medium, light handheld; then a tight detail of hands and spanner | `BP 0–6s`, `S05`, `S17` | 20s × 3 | Centre-safe |

### CB — Chop bar (Day 1)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| CB-01 | The cook stirring a large pot, steam rising | Medium close, side light from the doorway | `BP 0–6s`, `S07` | 20s × 3 | Centre-safe |
| CB-02 | Bowls served to a full bench: the chop bar as caterer | Medium; customers' faces incidental or released | `CC2 3–22s` | 15s × 3 | Both |

### SL — Salon and barbershop (Day 1)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| SL-01 | A braider, as themselves, at work with a client in the chair | Medium, then a tight detail of the hands braiding | `CP 26–38s`, `BP 25–38s`, `BC3 20–32s`, `CC2 3–22s`, `S19` | 20s × 3 | Both |
| SL-02 | A barber, as themselves, at work: clippers, a finished fade | Medium close; no product branding in frame | `CC2 3–22s` | 20s × 3 | Both |

### GT — Residential gate (Day 1)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| GT-01 | A delivery rider pulls up on a motorbike at a Kumasi residential gate, parcel in hand | Medium-wide from the gate side; the rider enters frame, stops, lifts the parcel. Plate out of shot unless released | `CP 38–50s`, `S14` | 20s × 3 | Both |

### FH — Family home (Day 1)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| FH-01 | A Kumasi family laughing together at home | Framed vertically for the split screen; eye-level, natural light at dusk | `CP 64–76s`, `S20` | 20s × 3 | Vertical |

### BW — Bonwire (Day 2)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| BW-01 | Akosua weaving: hands, shuttle, the strip growing | Tight on hands, then medium; slow slider or handheld drift | `BP 0–6s`, `S03` | 30s × 3 | Both |
| BW-02 | Akosua at her stall as foot traffic passes without stopping | Wide, locked off, Akosua in the centre third | `BP 6–14s` | 20s × 3 | Centre-safe |
| BW-03 | Akosua photographs a finished kente strip on her phone in the shop | Medium over the shoulder, then on her face | `BP 14–25s` | 20s × 3 | Both |
| BW-04 | Akosua's phone on the loom bench. Take A: it buzzes once; she glances and smiles. Take B: it buzzes again and again, screen unreadable; she turns it face-down and weaves | Close on the bench with the loom behind; focus pull to Akosua | `BP 25–38s`, `BC3 hook`, `BC3 3–20s`, `S18` | 15s × 3 per take | Both |
| BW-05 | The rider loads a parcel onto a motorbike outside the shop, turns and leaves frame | Medium-wide | `BP 25–38s`, `BC3 20–32s` | 20s × 3 | Both |
| BW-06 | Akosua keeps weaving | Wide over the shoulder, with room above her for headline text | `BP 38–48s`, `BC3 3–20s`, `S15` | 20s × 3 | Both |
| BW-07 | Akosua at the loom bench checks her dashboard on her phone | Medium. The screen is not legible here; its inserts are OF-03 | `BP 48–60s`, `BC2 18–32s` | 15s × 3 | Both |
| BW-08 | Akosua looks up from the loom and smiles | Medium close, eye-level, hold 3s after the smile | `BP 80–88s`, `S10` | 15s × 5 | Both |
| BW-09 | Akosua holds a loan form with *Financial records* circled in red (a prop: no bank name or logo); the host beside her, to camera | Medium two-shot | `BC2 hook` | 15s × 5 | Both |
| BW-10 | Host at the loom, to camera, as the phone buzzes behind | Medium close, host centred, loom soft behind | `BC3 hook` | 15s × 5 | Both |
| BW-11 | A real AshantiHub scout arrives at Akosua's shop and checks the GhanaPost GPS plate against the signboard | Wide, then a detail of the plate. No third-party logos on the signboard | `CP 15–26s`, `CC1 3–20s` | 20s × 3 | Both |
| BW-12 | The scout talks with Akosua at the shop door | Medium two-shot. No Ghana Card legible at any point | `CP 15–26s`, `CC1 3–20s`, `S21` | 20s × 3 | Both |
| BW-13 | Finished kente cloth on display in the shop | Slow tilt across the cloth, then tight textures | `CC2 3–22s`, `S13` | 15s × 3 | Both |

### OF — AshantiHub office (Day 3)

Every phone and laptop insert is filmed here under controlled light, following the
*Phone-insert protocol*.

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| OF-01 | A real AshantiHub Support agent answers enquiries and reviews a dispute at a desk | Medium on the agent, practical desk light | `BP 38–48s`, `BC3 3–20s`, `CP 50–64s`, `CC3 22–34s` | 20s × 3 | Centre-safe |
| OF-02 | The agent's laptop: the staff inbox reply, then the dispute | Over-the-shoulder insert, browser fullscreen, screen legible | `BP 38–48s`, `BC3 3–20s`, `CP 50–64s`, `CC3 22–34s` | 10s × 3 per screen | Centre-safe |
| OF-03 | Akosua's phone: her storefront, Order #1, her orders, her Credit Score with *Lending partners coming soon* | Insert; Akosua's own hands and Day 2 sleeve | `BP 14–25s`, `BP 25–38s`, `BP 48–60s`, `BC2 18–32s`, `BC3 20–32s` | 10s × 3 per screen | Both |
| OF-04 | The trader's phone: the registration steps on the throwaway account, the plan step with *Your first billing cycle is FREE*, then the second demo store's storefront and its first order | Insert; the trader's own hands and Day 1 sleeve | `BP 70–80s`, `BC1 3–20s`, `BC1 20–32s` | 10s × 3 per screen | Both |
| OF-05 | The demo customer's phone: the kente stole listing and *🎧 Contact Support*, the Support chat and its reply, the cart, checkout, *Raise a dispute*, a verified listing, a review with *Verified Purchase*, the demo service booking | Insert; the demo customer's own hands and Day 3 sleeve | `CP 26–38s`, `CP 38–50s`, `CP 50–64s`, `CC1 3–20s`, `CC1 20–32s`, `CC2 3–22s`, `CC3 3–22s`, `CC3 22–34s` | 10s × 3 per screen | Both |
| OF-06 | The scout's phone: the staff app marking Akosua's shop **✓ Visited** | Insert; the scout's own hands and Day 2 sleeve | `CP 15–26s`, `CC1 3–20s` | 10s × 3 | Both |

### AP — Apartment (Day 3)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| AP-01 | The demo customer frowns at a phone, screen facing away from camera, then sets it down | Medium close, window light | `CP 6–15s` | 20s × 3 | Both |
| AP-02 | The demo customer on the sofa with a phone: adds to cart, checks out, raises a dispute, taps Contact Support, reads the reply | Medium, then over-the-shoulder. The screen is not legible here; its inserts are OF-05 | `CP 26–38s`, `CC1 20–32s`, `CC3 3–22s`, `CC3 22–34s` | 15s × 3 per action | Both |
| AP-03 | Host to camera, mock-confused | Medium close, host centred | `CC3 hook` | 15s × 5 | Both |

### CF — Café (Day 3)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| CF-01 | The demo customer at a café table browsing theashantihub.com on a laptop | Medium | `BP 60–70s` | 15s × 3 | Centre-safe |
| CF-02 | The laptop: the homepage Hero showing Akosua's shop | Over-the-shoulder insert, browser fullscreen, screen legible | `BP 60–70s` | 10s × 3 | Centre-safe |

### AR — Prempeh I Airport (Day 3)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| AR-01 | Host in the arrivals hall with a travel bag, to camera | Medium; travellers incidental or out of focus; no airline or bank logos in frame | `CC2 hook`, `S11` | 15s × 5 | Both |

### EV — A real AshantiHub-listed event (pickup)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| EV-01 | The demo customer and friends walk up to the gate | Medium-wide from inside the gate | `CP 26–38s`, `BP 25–38s` | 20s × 3 | Both |
| EV-02 | The demo customer's real ticket on the phone | Insert, following the *Phone-insert protocol* | `CP 26–38s` | 10s × 3 | Both |
| EV-03 | The ticket QR is scanned at the gate | Close-up of the phone and the scanner hand, shallow focus | `CP 50–64s`, `CC2 22–34s` | 15s × 3 | Centre-safe |
| EV-04 | The organiser's check-in screen confirming the check-in | Insert, with the organiser's consent; no other attendee's details visible | `CP 50–64s`, `CC2 22–34s` | 10s × 3 | Centre-safe |

### RM — Remote (pickup)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| RM-01 | The diaspora talent in a winter coat, outdoors abroad, smiling at a phone | Self-shot on a phone, eye-level, natural light; brief and release sent in advance | `CP 64–76s` | 20s × 3 | Vertical |

### MH — Manhyia Palace (pickup)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| MH-01 | Manhyia Palace exterior | Wide, morning light | `S01` | Stills | — |
| MH-02 | Akwasidae: the procession and celebration | Wide and medium, as the palace permits | `S04` | Stills | — |

### HT — A hotel listed on AshantiHub (pickup)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| HT-01 | The hotel's exterior and lobby | Wide, with the hotel's consent | `S06` | Stills | — |

---

## Phone-insert protocol

- **One clean phone per character**, no case, the same handset in that character's scenes and
  inserts. Notifications silenced, brightness matched to the scene, shutter 1/50 to avoid
  flicker.
- **The hands are the character's own**, in the same sleeve as their scenes. Akosua, the Kejetia
  trader, the scout and the demo customer attend Day 3 for their inserts.
- **The app runs as the installed PWA**, so no browser bar shows `test.theashantihub.com`. The
  laptop runs the browser fullscreen.
- **Accounts:** demo-store and demo-customer inserts use the staging demo accounts. Real-business
  inserts use production, with consent. The event ticket is a real production ticket.
- **Hold each insert 2–3s**, centre-safe for the 9:16 crop, with the words that carry the claim
  readable.
- **Test identity data only.** No Ghana Card on screen, no real phone numbers, no real customers'
  names.
- **If an insert is unreadable, reshoot it.** Never replace a screen in post.
- The *Demo store* super is added in the edit to every insert that shows a demo store.

---

## Staging prep for phone inserts

The inserts show the real app, so these must exist on staging before Day 3, created the same way
as the existing demo data (`seed_demo.py` and real flows).

| Needed for | On staging |
|---|---|
| `CP 26–38s`, `CC2 3–22s` | A demo service business + listing, booked by the demo customer |
| `CP 50–64s`, `BP 14–25s` | A real review by the demo customer on Order #1, approved through moderation |
| `CP 50–64s`, `CC1 20–32s` | A dispute raised by the demo customer on a demo order |
| `BP 60–70s` | A Hero submission by Akosua Ntoma, approved by staff |
| `CP 15–26s`, `CC1 3–20s` | A scout assignment for Akosua Ntoma, ready to mark **Visited** on camera |
| `BC1 3–20s`, `BP 70–80s` | A throwaway business account for the registration inserts (stopped before submitting), with test identity data |
| `BC1 20–32s` | The second demo store: approved, one listing, one demo order from the demo customer |

**On production, with consent (not staging):** the demo customer buys a real ticket for a real
AshantiHub-listed event, and the organiser checks that ticket in at the gate (`CP 26–38s`,
`CP 50–64s`, `CC2 22–34s`). The organiser consents to the gate and their check-in screen being
filmed.

---

## Stills shot list

Shot alongside the video by the same crew. Full-resolution JPEG plus RAW, with releases logged
per frame.

| Still | Use | Subject | Formats |
|---|---|---|---|
| S01 | Website: Manhyia Palace | The palace exterior | 16:9 |
| S02 | Website: Kejetia market | The market from the rooftop at dawn | 16:9 |
| S03 | Website: kente weaving | Akosua's hands at the loom | 16:9, 4:5 |
| S04 | Website: Akwasidae | The festival at Manhyia | 16:9 |
| S05 | Website: Suame | The mechanic at work | 16:9 |
| S06 | Website: hotel | A listed hotel that consents | 16:9 |
| S07 | Website: chop bar | The cook at the pot | 16:9 |
| S08 | Website: Kumasi aerial | The city from the rooftop | 16:9 |
| S09 | Poster / thumbnail | The host at a Kejetia stall, room for a headline | 16:9, 4:5, 9:16 |
| S10 | Poster / thumbnail | Akosua's smile at the loom, room for a headline | 16:9, 4:5, 9:16 |
| S11 | WhatsApp Status | The host at arrivals | 9:16 |
| S12 | WhatsApp Status | Kejetia stall life | 9:16 |
| S13 | WhatsApp Status | Kente cloth close-up | 9:16 |
| S14 | WhatsApp Status | The rider at the gate | 9:16 |
| S15 | Headline: *Let the world find you.* | Akosua weaving, wide, room above her | 16:9, 4:5 |
| S16 | Headline: *Nothing to pay to join. Your first billing cycle is on us.* | The trader smiling at the phone | 16:9, 4:5 |
| S17 | Headline: *Your hustle deserves a track record.* | The mechanic at work | 16:9, 4:5 |
| S18 | Headline: *Less chasing. More selling.* | The phone face-down on the loom bench, Akosua weaving | 16:9, 4:5 |
| S19 | Headline: *Sell. Take bookings. Sell tickets. All from one page.* | The braider with a client | 16:9, 4:5 |
| S20 | Headline: *From Kejetia to the diaspora, in one tap.* | The family at home | 16:9, 4:5 |
| S21 | Headline: *Verified. Trusted. Found.* | The scout and Akosua at the shop door | 16:9, 4:5 |

The website stills replace the third-party photos that `frontend/App.jsx` (`KUMASI_PHOTOS`)
hotlinks today; swapping them in is a separate change.

---

## B-roll (grab whenever there's a spare minute)

| Location | Shots |
|---|---|
| Kejetia / Adum | Stall details (cloth, produce, sandals), hands exchanging goods, trotros, a seller arranging a display |
| Bonwire | Finished kente strips stacked, shuttles and heddles close-up, threads on spools, the village signboard (if no third-party logos) |
| Suame | Tools on a bench, sparks or a welding glow (safe distance), a finished repair driving off |
| Chop bar | Bowls being served, fufu being pounded, a full bench of customers (releases or faces out of focus) |
| Salon and barbershop | Combs, braiding hair, clippers on a shelf (no product branding) |
| Streets | An okada or rider passing, a gate opening, evening lights in Kumasi |
| Airport | Luggage trolleys, a welcome hug (released); no airline logos |

---

## Audio

- **No music on set.** The music beds and the voiceover are added in the edit.
- Capture clean **natural sound** with every shot: loom shuttle clack, market hubbub, spanner on
  metal, pot stirring and sizzle, clippers, a motorbike arriving, the gate scanner.
- Record **30s of room tone** at every location (everyone silent, same mic position).
- **The host's hooks are sync sound:** a lav on the host plus a backup recorder; slate every take.
- **Host VO, Day 3, 11:00–11:45**, in a quiet room at the office: both promos and all six clips,
  three passes of each, on the lav plus the backup recorder, 48 kHz WAV.
- No talking behind the camera during takes. Note any noisy takes in the log.

---

## Release-form checklist

- [ ] **Host:** a paid talent release covering AshantiHub web and social video ads, with a stated
  term of use.
- [ ] **Akosua:** a portrayal release stating she plays the fictional *Akosua Ntoma* demo store.
- [ ] **Kejetia trader:** a portrayal release stating they play the second demo store.
- [ ] **Real businesses** (mechanic, cook, braider, barber, organiser, hotel): a personal release
  plus the business's consent to show its premises, name and signboard. Their storefront appears
  in an insert only with explicit consent; their orders, revenue or credit figures never appear.
- [ ] **Everyone else on camera:** scout, Support agent, rider, demo customer, friends at the
  event, the family, the diaspora talent. A release each.
- [ ] **Guardian consent** for anyone under 18.
- [ ] **Riders' plates** out of shot unless consented.
- [ ] **Property releases:** the rooftop, workshop, chop bar, salon, barbershop, the gate's home,
  the family home, the Bonwire shop, the apartment, the café, the hotel.
- [ ] **Permissions:** Kumasi Metropolitan Assembly (Kejetia), GCAA (drone, if used), Ghana
  Airports Company (Prempeh I), Manhyia Palace, the Bonwire chief and elders (courtesy visit), the
  event organiser.
- [ ] **Crowds:** faces incidental or out of focus. Ghana's Data Protection Act, 2012 (Act 843)
  expects consent for identifiable people used commercially.
- [ ] Scans of every signed release saved with the footage, logged in a sheet (name · setup ·
  date · contact).

---

## Post-production

- **Voiceover:** the host's Day 3 recording. Before then, the editor rough-cuts against a scratch
  VO generated with the local ElevenLabs tooling in `marketing/video/`.
- **Music:** ElevenLabs instrumental highlife beds, generated to each final cut's length (one per
  promo, one per clip). Confirm before publishing that the ElevenLabs plan's terms allow
  commercial use of Eleven Music output.
- **Edit:** the crew's editor in Resolve or Premiere, on 30 fps timelines. The Remotion project is
  not part of the live-action edit; its end card is supplied as a reference render.
- **Style sheet** (from DESIGN.md):
  - Headings and end-card lines: **Fraunces**, weight 500–600. Supers and captions: **Plus
    Jakarta Sans**.
  - Gold `#D4A017` on dark brown `#2C1810` for the end card, with the woven kente edge; cream
    `#FDF6E3` and light gold `#F5DEB3` for supers on dark footage.
  - Supers centre-safe, and in 9:16 clear of the bands where Reels, TikTok and Shorts overlay
    their own controls.
- **Masters:** 16 MP4s (2 promos and 6 clips, each in 16:9 and 9:16). H.264, captions burned in,
  mixed to −14 LUFS integrated with true peaks at or below −1 dBTP. Plus an SRT per video for
  YouTube and the web, and thumbnails from the stills.
- **Review gate:** each rough cut is checked before it is finalised:
  - every claim matches what the app does today
  - *Demo store* supers and the end-card fine print are present
  - no third-party logos in frame
  - every identifiable face has a logged release

  Nothing is published until the checklist passes.

---

## Delivery spec

| | |
|---|---|
| **Resolution** | 3840×2160 (4K UHD) preferred, 1920×1080 minimum. Vertical takes 2160×3840 or 1080×1920 |
| **Frame rate** | **30 fps** for everything (the edit timeline is 30 fps; don't mix 25 and 30) |
| **Shutter** | 1/60 outdoors; **1/50 or 1/100 under indoor mains lighting** to avoid 50 Hz flicker |
| **Codec** | H.264/H.265 at ≥ 50 Mbps, or ProRes. Flat or log profile optional; if log, name the LUT |
| **Audio** | 48 kHz, on-camera or a separate recorder; room tone and VO as separate `.wav` files |
| **File naming** | `<setup>_take<n>.mp4`, with `_v` for a vertical take: `BW-04_take2_v.mp4`. Stills `<still>_<setup>_<frame>.jpg`: `S03_BW-01_0012.jpg`. Room tone `roomtone_<location code>.wav`. VO `vo_<video>_pass<n>.wav`: `vo_BP_pass2.wav` |
| **Hand-off** | One folder per shoot day and pickup, plus a `releases/` folder and the shot log (setup · take · notes · best take) |
