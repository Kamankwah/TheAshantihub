import { C } from "../../theme.js";
import { isStaffSession } from "../../lib/staffSession.js";
import logoIcon from "../../assets/logo/logo-icon.png";
import AccountMenu from "../AccountMenu.jsx";
import { useCanBuy } from "../../hooks/useCanBuy.js";
import { categoryPath, sendCategoryVisit, useCategoryTree } from "../../hooks/useCategoryTree.js";
import { useMyCustomerProfile } from "../../hooks/useMyCustomerProfile.js";
import SearchBar from "./SearchBar.jsx";
import { BODY_FONT, HEADING_FONT, TABULAR } from "./storefrontType.js";

// The marketplace home's header (it replaces the Navbar's bar on "/" only;
// every other page keeps the Navbar). Amazon's layout in AshantiHub's look:
// a dark-brown band (void in dark mode) with a 4px flag edge — logo, "Deliver
// to", the search with its department picker, then the theme toggle,
// notifications (signed in), the account entry, Wishlist and Cart — and below
// it a slightly lighter strip of departments from the shopper tree, which
// scrolls sideways on a phone.
//
// - Deliver to: a signed-in customer's saved address (the `address` on their
//   profile, GET /api/accounts/customers/me/profile/); otherwise "Ghana".
//   Nothing is guessed.
// - Account: signed out, "Hello, sign in" opens the auth modal; signed in,
//   the same AccountMenu as the Navbar.
// - Wishlist stays live before opening. Cart (customers and signed-out
//   visitors; business owners and staff have no cart) is greyed with the
//   useCanBuy label ("Opens 6 Nov") until the shopper can buy.
// - Phones (≤760px): the actions take the row beside the logo and wrap onto a
//   second line rather than spill past the screen; the "Hello, <name>" line is
//   cut with an ellipsis, and the cart's "Cart" word is dropped (the closed
//   "Opens <D Mon>" label always stays visible).
// Everything App owns is threaded in as props; this file never imports App.
const MOBILE = 760;

export default function StorefrontHeader({
  user, onSignOut,
  setAuthModal, setShowAccount, setShowBizDash, setShowPayments, setShowCart, setShowFavs, setShowNotifs,
  cartCount = 0, wishlistCount = 0, notifCount = 0,
  theme, toggleTheme,
  onNavigate, onLogoClick,
}) {
  const isBusiness = user?.accountType === "business_owner";
  const isCustomer = user?.accountType === "customer";
  const isStaff = isStaffSession(user);
  const accountLabel = isBusiness ? "Business Owner" : isStaff ? "Staff · view only" : "Customer";
  const { canBuy, label: closedLabel } = useCanBuy();
  const profile = useMyCustomerProfile(isCustomer);
  const savedAddress = isCustomer ? (profile.data?.address || "").trim() : "";
  const firstName = (user?.fullName || "").trim().split(/\s+/)[0];
  const { data: tree } = useCategoryTree();
  const departments = Array.isArray(tree) ? tree : [];
  const dark = theme === "dark";
  const showCart = !user || isCustomer;

  const openDepartment = (node) => {
    sendCategoryVisit(node.id);
    onNavigate(categoryPath(node));
  };
  const openResult = (row) => onNavigate(row.kind === "event" ? `/events/${row.id}` : `/business/${row.id}`);
  const submitSearch = ({ q, category }) => {
    const params = new URLSearchParams({ q });
    const node = departments.find((d) => d.slug === category);
    if (node && node.kind !== "event") params.set("category", category);
    onNavigate(node?.kind === "event" ? `/events?category=${encodeURIComponent(category)}` : `/business?${params}`);
  };
  const onCart = () => {
    if (!canBuy) return;
    if (!user) setAuthModal("login");
    else setShowCart(true);
  };

  return (
    <header
      data-theme={dark ? "dark" : "light"}
      style={{ position: "sticky", top: "var(--ah-top-offset, 0px)", zIndex: 100, background: dark ? C.void : C.darkBrown, color: C.white, fontFamily: BODY_FONT, borderBottom: `1px solid ${dark ? `${C.gold}40` : "transparent"}`, boxShadow: "0 2px 12px rgba(22,14,8,0.35)" }}
    >
      <div aria-hidden="true" style={{ height: 4, background: `linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)` }} />
      <div className="ah-sf-bar" style={{ display: "grid", gridTemplateColumns: "auto auto minmax(0,1fr) auto", gridTemplateAreas: '"logo deliver search actions"', alignItems: "center", gap: "8px 16px", padding: "10px 16px" }}>
        <button type="button" onClick={onLogoClick} aria-label="AshantiHub home" style={{ gridArea: "logo", display: "flex", alignItems: "center", gap: 8, padding: 0, border: "none", background: "transparent", color: C.gold, cursor: "pointer", minWidth: 0 }}>
          <img src={logoIcon} alt="" style={{ height: 36, width: "auto", display: "block" }} />
          <span className="ah-sf-wordmark" style={{ fontFamily: HEADING_FONT, fontWeight: 600, fontSize: 20, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>AshantiHub</span>
        </button>

        <div className="ah-sf-deliver" style={{ gridArea: "deliver", display: "flex", alignItems: "center", gap: 6, minWidth: 0, maxWidth: 200 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.lightGold} strokeWidth="2" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0, lineHeight: 1.2 }}>
            <span style={{ fontSize: 12, color: C.lightGold, opacity: 0.85 }}>{isCustomer && firstName ? `Deliver to ${firstName}` : "Deliver to"}</span>
            <span style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{savedAddress || "Ghana"}</span>
          </span>
        </div>

        <div style={{ gridArea: "search", minWidth: 0 }}>
          <SearchBar onOpenResult={openResult} onSubmit={submitSearch} />
        </div>

        <div className="ah-sf-actions" style={{ gridArea: "actions", display: "flex", alignItems: "center", gap: 4 }}>
          <button type="button" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle theme" style={iconButton}>
            <span aria-hidden="true">{dark ? "☀️" : "🌙"}</span>
          </button>
          {user && (
            <button type="button" onClick={() => setShowNotifs((n) => !n)} aria-label="Notifications" title="Notifications" style={{ ...iconButton, position: "relative" }}>
              <span aria-hidden="true">🔔</span>
              {notifCount > 0 && <span style={{ ...countBadge, background: C.kente1, color: C.white }}>{notifCount > 99 ? "99+" : notifCount}</span>}
            </button>
          )}
          {user ? (
            <AccountMenu
              user={user}
              accountLabel={accountLabel}
              isBusiness={isBusiness}
              isStaff={isStaff}
              onBizDash={() => setShowBizDash(true)}
              onPayments={() => setShowPayments(true)}
              onAccount={() => setShowAccount(true)}
              onSignOut={onSignOut}
              triggerStyle={{ ...textButton, alignItems: "flex-start" }}
            >
              <span className="ah-sf-hello" style={smallLine}>Hello, {firstName || "there"}</span>
              <span className="ah-sf-label" style={boldLine}>Account ▾</span>
            </AccountMenu>
          ) : (
            <button type="button" onClick={() => setAuthModal("login")} style={{ ...textButton, alignItems: "flex-start" }}>
              <span style={smallLine}>Hello, sign in</span>
              <span className="ah-sf-label" style={boldLine}>Account</span>
            </button>
          )}
          <button type="button" onClick={() => setShowFavs(true)} aria-label={`Wishlist, ${wishlistCount} saved`} style={textButton}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span aria-hidden="true" style={{ fontSize: 18 }}>♡</span>
              <span style={{ ...boldLine, ...TABULAR }}>{wishlistCount}</span>
            </span>
            <span className="ah-sf-label" style={smallLine}>Wishlist</span>
          </button>
          {showCart && (
            <button
              type="button"
              onClick={onCart}
              disabled={!canBuy}
              aria-label={canBuy ? `Cart, ${cartCount} items` : `Cart — ${closedLabel}`}
              title={canBuy ? "Cart" : closedLabel}
              style={{ ...textButton, opacity: canBuy ? 1 : 0.55, cursor: canBuy ? "pointer" : "not-allowed" }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h3l2.6 12.2a1.5 1.5 0 0 0 1.5 1.2h8.7a1.5 1.5 0 0 0 1.5-1.1L21 8H6" /></svg>
                {canBuy && <span style={{ ...boldLine, color: C.gold, ...TABULAR }}>{cartCount}</span>}
              </span>
              <span className={canBuy ? "ah-sf-label" : undefined} style={smallLine}>{canBuy ? "Cart" : closedLabel}</span>
            </button>
          )}
        </div>
      </div>

      <nav aria-label="Departments" className="ah-sf-strip" style={{ background: "rgba(255,255,255,0.07)", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <ul style={{ listStyle: "none", margin: 0, padding: "0 8px", display: "flex", gap: 2, whiteSpace: "nowrap" }}>
          <li><button type="button" onClick={() => onNavigate("/business")} style={stripButton}>All businesses</button></li>
          <li><button type="button" onClick={() => onNavigate("/events")} style={stripButton}>Events</button></li>
          {departments.map((node) => (
            <li key={node.id}><button type="button" onClick={() => openDepartment(node)} style={stripButton}>{node.label}</button></li>
          ))}
          <li><button type="button" onClick={() => onNavigate("/about")} style={stripButton}>About</button></li>
          <li><button type="button" onClick={() => onNavigate("/contact")} style={stripButton}>Contact</button></li>
        </ul>
      </nav>

      <style>{`
        .ah-sf-strip button:hover, .ah-sf-actions button:hover:not(:disabled) { box-shadow: inset 0 0 0 1px ${C.gold}88; }
        @media (max-width: ${MOBILE}px) {
          .ah-sf-bar { grid-template-columns: auto minmax(0,1fr) !important; grid-template-areas: "logo actions" "search search" "deliver deliver" !important; padding: 8px 12px !important; column-gap: 8px !important; }
          .ah-sf-actions { flex-wrap: wrap; justify-content: flex-end; gap: 2px !important; min-width: 0; }
          .ah-sf-actions > button, .ah-sf-actions > div > button[aria-label="Account menu"] { padding-left: 6px !important; padding-right: 6px !important; }
          .ah-sf-hello { display: block; max-width: 76px; overflow: hidden; text-overflow: ellipsis; }
          .ah-sf-deliver { max-width: none !important; }
          .ah-sf-label, .ah-sf-wordmark { display: none !important; }
        }
      `}</style>
    </header>
  );
}

const iconButton = {
  width: 40, height: 40, borderRadius: 10, border: "none", background: "transparent", color: C.white,
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 17, flexShrink: 0,
};
const textButton = {
  display: "flex", flexDirection: "column", justifyContent: "center", minHeight: 44, padding: "4px 8px", borderRadius: 10,
  border: "none", background: "transparent", color: C.white, cursor: "pointer", fontFamily: BODY_FONT, textAlign: "left", flexShrink: 0,
};
const smallLine = { fontSize: 12, lineHeight: 1.2, color: C.lightGold, whiteSpace: "nowrap" };
const boldLine = { fontSize: 14, lineHeight: 1.2, fontWeight: 700, color: C.white, whiteSpace: "nowrap" };
const countBadge = {
  position: "absolute", top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 999, fontSize: 10, fontWeight: 800,
  display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
};
const stripButton = {
  minHeight: 40, padding: "8px 12px", border: "none", borderRadius: 8, background: "transparent", color: C.white,
  fontFamily: BODY_FONT, fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
};
