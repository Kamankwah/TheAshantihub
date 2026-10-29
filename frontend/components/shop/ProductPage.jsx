import { useEffect, useMemo, useRef, useState } from "react";
import { C } from "../../theme.js";
import { apiErrorMessage } from "../../lib/apiErrorMessage.js";
import { mediaOf } from "../../lib/listingMedia.js";
import { aboutBullets, attributeRows } from "../../lib/listingFacts.js";
import { useListing } from "../../hooks/useListing.js";
import { useListingReviews } from "../../hooks/useListingReviews.js";
import { useAlsoViewed } from "../../hooks/useAlsoViewed.js";
import { useWishlist } from "../../hooks/useWishlist.js";
import { useSponsored } from "../../hooks/useSponsored.js";
import { useRecordView } from "../../hooks/useRecordView.js";
import { useSiteSettings } from "../../hooks/useSiteSettings.js";
import { useStaffGate } from "../../hooks/useStaffGate.js";
import useBreakpoint from "../../hooks/useBreakpoint.js";
import usePrefersReducedMotion from "../../hooks/usePrefersReducedMotion.js";
import ScrollSpyTabs from "../ScrollSpyTabs.jsx";
import SellerRatingBadge from "../SellerRatingBadge.jsx";
import StaffGateNotice from "../StaffGateNotice.jsx";
import FlashPriceTag from "../FlashPriceTag.jsx";
import { ReviewsList, ReviewWriteForm, starString } from "../ReviewComponents.jsx";
import { BODY_FONT, HEADING_FONT, TABULAR } from "../storefront/storefrontType.js";
import ProductGallery from "./ProductGallery.jsx";
import VariantPicker from "./VariantPicker.jsx";
import BuyBox from "./BuyBox.jsx";
import PriceTag from "./PriceTag.jsx";
import { cheapestPrice } from "./cheapestPrice.js";
import ReviewHistogram from "./ReviewHistogram.jsx";
import ProductCarousel, { AlsoViewedCarousel, ProductTile } from "./ProductCarousel.jsx";

// ─── ProductPage ────────────────────────────────────────────────────────────
// The page for goods (things delivered: products and food), Marketplace Plan 4.
// Services and stays keep the older page (ListingDetailPage chooses). Themed
// with the light/dark tokens (ruling P14). Every figure is the server's: the
// listing detail, its reviews envelope, the also-viewed and sponsored feeds.
//
// Desktop: breadcrumb · gallery | title, seller, rating, price, options, key
// facts, About this item | buy box + one sponsored product. Phone: one column,
// gallery, buy box, then the details. Below, a sticky strip (Top · About this
// item · Similar · Product information · Reviews; a section with nothing to show
// is left out) with the mini title + price once the shopper has scrolled on.
//
// The page owns the variant `selection` ({[variantId]: quantity}); what reaches
// the picker and the buy box is always reconciled with the listing as last
// fetched, so a refetch can never leave a vanished option or an over-stock
// quantity in the add. No questions-and-answers, no business contact: "Report
// an issue" and "Contact Support" go to AshantiHub Support via `onMessage`.
const SECTION_IDS = { top: "pdp-top", about: "pdp-about", similar: "pdp-similar", info: "pdp-info", reviews: "pdp-reviews" };
const SIGN_IN_TO_BUY = "Sign in as a customer to add items to your cart.";

// The selection with every line checked against the listing's current variants: a variant that is gone or
// unavailable is dropped, and a quantity above a counted stock is brought down to it.
export function reconcileSelection(selection, variants) {
  const out = {};
  for (const v of variants) {
    const qty = Number(selection?.[v.id]) || 0;
    if (qty <= 0 || v.available === false) continue;
    const capped = v.stock_quantity == null ? qty : Math.min(qty, v.stock_quantity);
    if (capped > 0) out[v.id] = capped;
  }
  return out;
}

export default function ProductPage({ id, onBack, user, currency = "GHS", onMessage, onOpenListing, onOpenSeller, onAddToCart, onShowDirect, onAddedToCart }) {
  const { data: item } = useListing(id);
  const reviewsQuery = useListingReviews(id);
  const alsoViewed = useAlsoViewed(id);
  const sponsoredQuery = useSponsored({ category: item?.category?.id ?? null, exclude: id });
  const settings = useSiteSettings();
  const breakpoint = useBreakpoint();
  const reducedMotion = usePrefersReducedMotion();
  const listGate = useStaffGate(user);
  const wishlist = useWishlist({ enabled: user?.accountType === "customer" });
  const [selection, setSelection] = useState({});
  const [preview, setPreview] = useState(null);
  const [guestNote, setGuestNote] = useState(null);
  const [listNote, setListNote] = useState(null);
  // Bumped after a successful add so the picker starts again with nothing chosen.
  const [pickerRound, setPickerRound] = useState(0);
  const saving = useRef(false);
  useRecordView(id, user);
  // A note about the previous session (sign in to buy / save) must not outlive it.
  useEffect(() => { setGuestNote(null); setListNote(null); }, [user?.id]);

  const variants = useMemo(() => (Array.isArray(item?.variants) ? item.variants : []), [item?.variants]);
  const picked = useMemo(() => reconcileSelection(selection, variants), [selection, variants]);

  if (!item) return null;

  const phone = breakpoint === "phone";
  const tablet = breakpoint === "tablet";
  const isBusinessAccount = !!user && !listGate.isStaff && user.accountType !== "customer";

  const crumbs = [...(Array.isArray(item.category?.ancestors) ? item.category.ancestors : []), item.category].filter((c) => c?.label);
  const bullets = aboutBullets(item.description);
  const facts = attributeRows(item);
  const specs = (Array.isArray(item.specs) ? item.specs : []).filter((s) => s?.label && s?.value);
  // Warranty & returns: what the seller declared on this listing (`has_warranty` false is also the unset default, so
  // it says nothing), plus AshantiHub's own published returns policy.
  const warranty = [
    item.has_warranty === true && ["Seller warranty", item.warranty_details || "This product comes with a warranty."],
    item.has_expiry === true && item.expiry_date && ["Expiry date", item.expiry_date],
    typeof item.return_policy === "string" && item.return_policy.trim() && ["Seller return policy", item.return_policy],
  ].filter(Boolean);
  const platformPolicy = settings.data?.warranty_returns_policy || "";
  const hasInfo = specs.length > 0 || warranty.length > 0 || Boolean(platformPolicy);

  // One sponsored product sits under the buy box on wider screens; the carousel carries the rest (all of them on a
  // phone, where a full-width card would come before the product's own details).
  const sponsored = Array.isArray(sponsoredQuery.data) ? sponsoredQuery.data : [];
  const sideAd = phone ? null : sponsored[0] || null;
  const moreSponsored = sideAd ? sponsored.slice(1) : sponsored;
  const alsoItems = Array.isArray(alsoViewed.data?.results) ? alsoViewed.data.results : [];
  const hasSimilar = alsoItems.length > 0 || moreSponsored.length > 0;

  // With options the headline reads "From": the cheapest option, not whatever price the listing row carries.
  const unitPrice = variants.length > 0 ? cheapestPrice(item) : item.effective_price ?? item.price_amount ?? null;
  const shown = preview || { price: unitPrice, wasPrice: item.was_price ?? null, discountPercent: item.discount_percent ?? null };
  const media = mediaOf(item);
  const thumb = media.find((m) => m.kind === "image")?.url || null;

  // A signed-out visitor pressing Add to cart: App's add-to-cart handler owns the sign-in prompt (it opens the sign-up
  // dialog and answers with its reason), so the page hands the press to it; the buy box itself posts only for a session.
  const handleGuestAdd = async () => {
    setGuestNote(null);
    if (!onAddToCart) { setGuestNote(SIGN_IN_TO_BUY); return; }
    try {
      await onAddToCart(item, 1);
    } catch (err) {
      setGuestNote(err?.message || SIGN_IN_TO_BUY);
    }
  };

  // "Add to list" keeps the item in the customer's Your Lists (POST /api/wishlist/, customers only).
  const saveToList = async () => {
    setListNote(null);
    if (!user) { setListNote({ ok: false, text: "Sign in to save this to Your Lists." }); return; }
    if (listGate.blocked() || saving.current) return;
    if (isBusinessAccount) { setListNote({ ok: false, text: "Lists are for customer accounts. Sign in with a customer account to save this." }); return; }
    saving.current = true;
    try {
      await wishlist.add(item.id);
      setListNote({ ok: true, text: "Saved to Your Lists." });
    } catch (err) {
      setListNote({ ok: false, text: apiErrorMessage(err, "Could not save this to Your Lists.") });
    } finally {
      saving.current = false;
    }
  };

  const scrollTo = (sectionId) => document.getElementById(sectionId)?.scrollIntoView?.({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });

  const gallery = (
    <div data-testid="product-gallery" style={{ minWidth: 0, position: "relative" }}>
      <ProductGallery media={media} title={item.name} activeVariantImage={preview?.image || null} />
    </div>
  );

  const details = (
    <div data-testid="product-details" style={{ minWidth: 0 }}>
      <h1 style={{ margin: "0 0 4px", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: phone ? "1.45rem" : "1.75rem", lineHeight: 1.15, letterSpacing: "-0.02em", color: C.ink }}>{item.name}</h1>
      <SellerRatingBadge businessOwner={item.business_owner} user={user} tone="theme" />
      {item.review_count > 0 && item.avg_rating != null && (
        <button type="button" data-testid="rating-row" onClick={() => scrollTo(SECTION_IDS.reviews)}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, margin: "2px 0 8px", cursor: "pointer", color: C.ink, fontFamily: "inherit", fontSize: "0.85rem" }}>
          <span style={{ fontWeight: 800, ...TABULAR }}>{Number(item.avg_rating).toFixed(1)}</span>
          <span aria-hidden="true" style={{ color: C.gold }}>{starString(item.avg_rating)}</span>
          <span style={{ color: C.info, textDecoration: "underline", ...TABULAR }}>{item.review_count} {item.review_count === 1 ? "rating" : "ratings"}</span>
        </button>
      )}
      <div style={{ borderTop: `1px solid ${C.line}`, margin: "8px 0 12px" }} />
      {shown.price != null && (
        <div data-testid="product-price" style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {!preview && variants.length > 0 && <span style={{ fontSize: "0.85rem", color: C.inkDim, fontWeight: 700 }}>From</span>}
          <PriceTag price={shown.price} wasPrice={shown.wasPrice} discountPercent={shown.discountPercent} currency={currency} />
          {item.price_unit && <span style={{ fontSize: "0.85rem", color: C.inkDim }}>{item.price_unit}</span>}
        </div>
      )}
      <FlashPriceTag listingId={item.id} />
      {variants.length > 0 && (
        <div style={{ margin: "12px 0" }}>
          <VariantPicker key={pickerRound} axes={item.variant_axes} variants={variants} selection={picked} onChange={setSelection} onPreview={setPreview} currency={currency} />
        </div>
      )}
      {facts.length > 0 && (
        <table data-testid="key-facts" style={{ borderCollapse: "collapse", margin: "12px 0", fontSize: "0.85rem" }}>
          <tbody>
            {facts.map((f) => (
              <tr key={f.label}>
                <th scope="row" style={{ textAlign: "left", padding: "3px 18px 3px 0", color: C.ink, fontWeight: 700, verticalAlign: "top" }}>{f.label}</th>
                <td style={{ padding: "3px 0", color: C.ink }}>{f.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {bullets.length > 0 && (
        <section id={SECTION_IDS.about} aria-labelledby="pdp-about-title" style={{ marginTop: 14, scrollMarginTop: 150 }}>
          <h2 id="pdp-about-title" style={subheading}>About this item</h2>
          <ul style={{ margin: 0, paddingLeft: 20, listStyle: "disc", display: "grid", gap: 6, fontSize: "0.88rem", lineHeight: 1.55, color: C.ink }}>
            {bullets.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </section>
      )}
    </div>
  );

  const buy = (
    <div data-testid="product-buy" style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
      {isBusinessAccount && (
        <div role="status" style={{ background: C.warnBg, color: C.warnInk, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", fontSize: "0.82rem", lineHeight: 1.5 }}>
          🛍️ Business accounts can't purchase on AshantiHub. Sign in with a customer account to buy.
        </div>
      )}
      <BuyBox
        item={item}
        user={user}
        selection={picked}
        currency={currency}
        onMessage={onMessage}
        onSaveToList={saveToList}
        onOpenSeller={onOpenSeller}
        onShowDirect={onShowDirect}
        onSignIn={handleGuestAdd}
        onAddToCart={onAddToCart}
        onOpenListing={onOpenListing}
        onAdded={() => { setSelection({}); setPreview(null); setPickerRound((n) => n + 1); if (onAddedToCart) onAddedToCart(); }}
      />
      {guestNote && <div role="alert" style={note(false)}>{guestNote}</div>}
      {listNote && <div role={listNote.ok ? "status" : "alert"} style={note(listNote.ok)}>{listNote.text}</div>}
      {listGate.shownFor && <StaffGateNotice />}
      {sideAd && (
        <div data-testid="sponsored-card" style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 14 }}>
          <div style={{ fontSize: "0.72rem", color: C.inkDim, marginBottom: 8 }}>Sponsored</div>
          <ProductTile item={sideAd} currency={currency} onOpen={onOpenListing} />
        </div>
      )}
    </div>
  );

  let hero;
  if (phone) hero = <div style={{ display: "grid", gap: 20 }}>{gallery}{buy}{details}</div>;
  else if (tablet) {
    hero = (
      <div style={{ display: "grid", gap: 24, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", alignItems: "start" }}>
        {gallery}
        <div style={{ display: "grid", gap: 20, minWidth: 0 }}>{details}{buy}</div>
      </div>
    );
  } else {
    hero = (
      <div style={{ display: "grid", gap: 28, gridTemplateColumns: "minmax(0, 5fr) minmax(0, 4fr) minmax(260px, 3fr)", alignItems: "start" }}>
        {gallery}{details}{buy}
      </div>
    );
  }

  const tabs = [
    { id: SECTION_IDS.top, label: "Top", external: true },
    bullets.length > 0 && { id: SECTION_IDS.about, label: "About this item", external: true },
    hasSimilar && { id: SECTION_IDS.similar, label: "Similar" },
    hasInfo && { id: SECTION_IDS.info, label: "Product information" },
    { id: SECTION_IDS.reviews, label: "Reviews" },
  ].filter(Boolean);

  const mini = (active) => (phone || active === SECTION_IDS.top ? null : (
    <div data-testid="sticky-mini" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      {thumb && <img src={thumb} alt="" width={32} height={32} style={{ objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />}
      <span style={{ fontSize: "0.8rem", fontWeight: 700, color: C.ink, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
      {unitPrice != null && variants.length > 0 && <span style={{ fontSize: "0.72rem", color: C.inkDim, fontWeight: 700 }}>From</span>}
      {unitPrice != null && <PriceTag price={unitPrice} currency={currency} size="1rem" />}
    </div>
  ));

  const reviewsData = reviewsQuery.data;
  const renderSection = (sectionId) => {
    if (sectionId === SECTION_IDS.similar) {
      return (
        <>
          <AlsoViewedCarousel listingId={id} currency={currency} onOpen={onOpenListing} />
          <ProductCarousel title="Sponsored products" items={moreSponsored} sponsored currency={currency} onOpen={onOpenListing} />
        </>
      );
    }
    if (sectionId === SECTION_IDS.info) {
      return (
        <div>
          <h2 style={heading}>Product information</h2>
          {specs.length > 0 && (
            <InfoGroup title="Item details">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <tbody>
                  {specs.map((s, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.line}` }}>
                      <th scope="row" style={{ textAlign: "left", padding: "8px 16px 8px 0", color: C.inkDim, fontWeight: 600, width: "40%", verticalAlign: "top" }}>{s.label}</th>
                      <td style={{ padding: "8px 0", color: C.ink }}>{s.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </InfoGroup>
          )}
          {(warranty.length > 0 || platformPolicy) && (
            <InfoGroup title="Warranty & returns">
              {warranty.map(([label, value]) => (
                <div key={label} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 800, color: C.ink, marginBottom: 2 }}>{label}</div>
                  <p style={paragraph}>{value}</p>
                </div>
              ))}
              {platformPolicy && (
                <div>
                  <div style={{ fontSize: "0.8rem", fontWeight: 800, color: C.ink, marginBottom: 2 }}>AshantiHub platform policy</div>
                  <p style={paragraph}>{platformPolicy}</p>
                </div>
              )}
            </InfoGroup>
          )}
        </div>
      );
    }
    if (sectionId === SECTION_IDS.reviews) {
      return (
        <div style={{ display: "grid", gap: 20, gridTemplateColumns: phone ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 2fr)", alignItems: "start" }}>
          <div style={{ display: "grid", gap: 18 }}>
            <h2 style={{ ...heading, margin: 0 }}>Customer reviews</h2>
            <ReviewHistogram distribution={reviewsData?.distribution} total={reviewsData?.review_count ?? 0} average={reviewsData?.avg_rating} />
            <ReviewWriteForm targetType="listing" targetId={id} user={user} tone="theme" label="Write a customer review" onReviewSubmitted={() => reviewsQuery.refetch()} />
          </div>
          <div style={{ minWidth: 0 }}>
            {reviewsQuery.isLoading
              ? <p style={{ ...paragraph, color: C.inkDim }}>Loading reviews…</p>
              : reviewsQuery.isError
                ? (
                  <div role="alert" style={note(false)}>
                    {"We couldn't load the reviews."}{" "}
                    <button type="button" onClick={() => reviewsQuery.refetch()} style={{ background: "none", border: "none", padding: 0, color: C.errInk, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit" }}>Try again</button>
                  </div>
                )
                : <ReviewsList reviews={reviewsData?.results || []} tone="theme" />}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div data-testid="product-page" style={{ maxWidth: 1280, margin: "0 auto", padding: "16px 16px 48px", boxSizing: "border-box", background: C.canvas, color: C.ink, fontFamily: BODY_FONT, borderRadius: 20 }}>
      <button type="button" onClick={onBack} style={{ background: C.surface, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 20, padding: "9px 16px", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", minHeight: 44, fontFamily: "inherit" }}>
        ‹ Back to results
      </button>
      <nav aria-label="Breadcrumb" style={{ margin: "12px 0 16px" }}>
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 6, fontSize: "0.78rem", color: C.inkDim }}>
          {crumbs.map((c, i) => (
            <li key={c.id ?? c.slug ?? i}>
              {i > 0 && <span aria-hidden="true" style={{ marginRight: 6 }}>›</span>}
              <span aria-current={i === crumbs.length - 1 ? "page" : undefined} style={{ color: i === crumbs.length - 1 ? C.ink : C.inkDim }}>{c.label}</span>
            </li>
          ))}
        </ol>
      </nav>

      <div id={SECTION_IDS.top} style={{ scrollMarginTop: 150 }}>{hero}</div>

      <ScrollSpyTabs tabs={tabs} renderSection={renderSection} tone="theme" trailing={mini} />
    </div>
  );
}

// A Product information group: open by default, its heading toggles it.
function InfoGroup({ title, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ borderTop: `1px solid ${C.line}`, padding: "4px 0 10px" }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", padding: "10px 0", cursor: "pointer", color: C.ink, fontFamily: "inherit", fontSize: "0.95rem", fontWeight: 800, minHeight: 44, textAlign: "left" }}>
        {title}
        <span aria-hidden="true" style={{ color: C.inkDim }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

const heading = { margin: "0 0 12px", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "1.35rem", lineHeight: 1.15, letterSpacing: "-0.02em", color: C.ink };
const subheading = { margin: "0 0 8px", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "1.1rem", lineHeight: 1.2, color: C.ink };
const paragraph = { margin: 0, fontSize: "0.85rem", lineHeight: 1.6, color: C.ink, whiteSpace: "pre-wrap" };
const note = (ok) => ({ background: ok ? C.okBg : C.errBg, color: ok ? C.okInk : C.errInk, borderRadius: 10, padding: "8px 10px", fontSize: "0.8rem", lineHeight: 1.5 });
