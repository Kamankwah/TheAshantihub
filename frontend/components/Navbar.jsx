import { useEffect, useRef, useState } from "react";
import { C } from "../theme.js";
import { isStaffSession } from "../lib/staffSession.js";
import logoIcon from "../assets/logo/logo-icon.png";

// ─── Navbar ────────────────────────────────────────────────────────────────
// Three-group layout: logo pinned far left, page nav centered, utility
// actions (language, notifications, auth) pinned far right. Replaces the old
// single-row "core actions + More popover" hybrid — Messages/Saved/Payments/
// currency (formerly in the "More" popover) are dropped from the navbar
// entirely per the redesign brief; Messages stays reachable via the floating
// ChatLauncher, Saved/Payments no longer have a navbar entry point.
// Transparent glass look over the home Hero; per-nav-item hover shows a gold
// glow border (no ambient whole-bar hover effect) via .ah-nav-item:hover.
//
// Signed-in state: Sign In/Create Account are fully replaced by a single
// round avatar button (real uploaded photo when `user.avatar` is set,
// initial-letter fallback otherwise — same treatment used by the mobile
// stacked-menu header avatar below) that opens a profile menu (Business
// Dashboard/Payments for business owners, My Account for customers, Sign
// Out for both). This used to sit next to a separate "My Dashboard"/"My
// Account" pill button that opened the same destination directly — merged
// away as a redundant second entry point so there's exactly one signed-in
// account control.
//
// Cart icon (docs/BUSINESS_EVENTS_ROADMAP.md Phase 4) sits between the
// notification bell and the auth/profile area, gated to signed-in Customer
// accounts only (business owners have no Cart on the backend) — badge shows
// the sum of item quantities. Opens CartDrawer via the setShowCart prop,
// same boolean-flag-owned-by-AshantiHub convention as setShowNotifs/
// setShowBizDash/etc.
//
// A staff session browsing the marketplace (view-only, under App.jsx's
// StaffViewOnlyBar) is labelled "Staff · view only", gets no customer-only
// My Account, and its Sign Out calls `onSignOut` (App.jsx's staff sign-out:
// cache wipe + land on /staff) instead of a bare auth.logout(). The bar is
// fixed above this header, so the sticky `top` reads App's `--ah-top-offset`.
// Hamburger at <=1024px; 1025-1199px is a compact inline tier (see the <style>
// block); >=1200px is the full header. The row needs ~1,150px uncompacted.
const NAV_BREAKPOINT = 1024;
const COMPACT_MAX = 1199;
const SOLIDIFY_SCROLL_Y = 60;

const NAV_ITEMS = [
  { id: "home", label: "Home" },
  { id: "business", label: "Adwaso" },
  { id: "events", label: "Events" },
  { id: "about", label: "About" },
  { id: "contact", label: "Contact" },
];

export default function Navbar({
  page, setPage,
  lang, setLang,
  user, auth,
  handleLogoClick,
  setAuthModal,
  setShowNotifs,
  setShowBizDash,
  setShowPayments,
  setShowAccount,
  setShowCart,
  cartCount = 0,
  notifCount = 0,
  theme,
  toggleTheme,
  T,
  onSignOut,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);

  const isBusiness = user?.accountType === "business_owner";
  // Cart (docs/BUSINESS_EVENTS_ROADMAP.md Phase 4) is a Customer-only
  // concept — the backend Cart model is one-to-one with Customer, business
  // owners have no cart, same "gate on user?.accountType" convention as
  // `isBusiness` above.
  const isCustomer = user?.accountType === "customer";
  const isStaff = isStaffSession(user);
  const accountLabel = isBusiness ? "Business Owner" : isStaff ? "Staff · view only" : "Customer";
  const signOut = onSignOut ?? (() => auth.logout());
  const act = (fn) => (...args) => { fn(...args); setMenuOpen(false); setProfileOpen(false); };
  const goToDashboard = () => (isBusiness ? setShowBizDash(true) : setShowAccount(true));

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > SOLIDIFY_SCROLL_Y);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!profileOpen) return;
    const onClick = (e) => { if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [profileOpen]);

  const transparent = page === "home" && !scrolled;

  const onLogoClick = () => {
    handleLogoClick();
    setPage("home");
    setMenuOpen(false);
  };

  const NavLinks = ({ stacked = false }) => (
    <>
      {NAV_ITEMS.map(({ id, label }) => {
        const active = page === id;
        return (
          <button
            key={id}
            className="ah-nav-item"
            onClick={act(() => setPage(id))}
            style={{
              background: active ? C.gold : "transparent",
              color: active ? C.black : "white",
              border: `1.5px solid ${active ? C.gold : "transparent"}`,
              borderRadius: 24,
              padding: "9px 18px",
              fontSize: "0.9rem",
              fontWeight: 700,
              cursor: "pointer",
              width: stacked ? "100%" : "auto",
              textAlign: stacked ? "left" : "center",
              transition: "border-color 0.2s ease, background 0.2s ease",
            }}
          >
            {label}
          </button>
        );
      })}
    </>
  );

  const UtilityActions = ({ stacked = false }) => (
    <>
      <button onClick={act(() => setLang(l => l === "en" ? "tw" : "en"))} aria-label={lang === "en" ? "Switch to Twi" : "Switch to English"} title={lang === "en" ? "Switch to Twi" : "Switch to English"} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.25)",borderRadius:24,padding:"8px 14px",fontSize:"0.8rem",fontWeight:700,cursor:"pointer",width:stacked?"100%":"auto"}}>
        {lang === "en" ? "🇬🇭" : "🇬🇧"}{" "}<span className="ah-lang-label">{lang === "en" ? "Twi" : "EN"}</span>
      </button>
      <button onClick={act(() => toggleTheme())} aria-label="Toggle theme" title="Toggle theme" style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.25)",borderRadius:24,padding:"8px 14px",fontSize:"0.8rem",fontWeight:700,cursor:"pointer",width:stacked?"100%":"auto"}}>
        {theme === "dark" ? "☀️" : "🌙"}
      </button>
      <button onClick={act(() => setShowNotifs(n => !n))} aria-label="Notifications" title="Notifications" style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.25)",borderRadius:"50%",width:38,height:38,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"1.05rem",position:"relative",flexShrink:0}}>
        🔔
        {user && notifCount > 0 && (
          <span style={{position:"absolute",top:-6,right:-6,background:C.kente1,color:"white",borderRadius:"50%",minWidth:16,height:16,fontSize:"0.6rem",fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 3px"}}>{notifCount > 99 ? "99+" : notifCount}</span>
        )}
      </button>
      {isCustomer && (
        stacked ? (
          <button onClick={act(() => setShowCart(true))} aria-label="View cart" style={{...utilityBtnStyle,width:"100%",justifyContent:"flex-start"}}>
            🛒 Cart{cartCount > 0 ? ` (${cartCount})` : ""}
          </button>
        ) : (
          <button onClick={act(() => setShowCart(true))} aria-label="View cart" style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.25)",borderRadius:"50%",width:38,height:38,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"1.05rem",position:"relative",flexShrink:0}}>
            🛒
            {cartCount > 0 && (
              <span style={{position:"absolute",top:-6,right:-6,background:C.gold,color:C.darkBrown,borderRadius:"50%",minWidth:16,height:16,fontSize:"0.6rem",fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 3px"}}>{cartCount}</span>
            )}
          </button>
        )
      )}
      {user ? (
        stacked ? (
          <>
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"6px 2px 2px"}}>
              <span style={{background:C.gold,color:C.darkBrown,borderRadius:"50%",width:36,height:36,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:"0.9rem",fontWeight:900,flexShrink:0,overflow:"hidden"}}>
                {user.avatar
                  ? <img src={user.avatar} alt="" style={{width:"100%",height:"100%",borderRadius:"50%",objectFit:"cover"}}/>
                  : (user.fullName?.[0]?.toUpperCase() || "U")}
              </span>
              <div>
                <div style={{color:"white",fontWeight:800,fontSize:"0.85rem"}}>{user.fullName}</div>
                <div style={{color:C.lightGold,fontSize:"0.66rem",opacity:0.8}}>{accountLabel}</div>
              </div>
            </div>
            {!isStaff && <button onClick={act(goToDashboard)} style={{...utilityBtnStyle,width:"100%",justifyContent:"flex-start"}}>{isBusiness ? "🏪 My Dashboard" : "👤 My Account"}</button>}
            {isBusiness && <button onClick={act(() => setShowPayments(true))} style={{...utilityBtnStyle,width:"100%",justifyContent:"flex-start"}}>💳 Payments</button>}
            <button onClick={act(signOut)} style={{...utilityBtnStyle,width:"100%",justifyContent:"flex-start",borderColor:`${C.kente1}66`,color:"#ffb4b4"}}>⏻ Sign Out</button>
          </>
        ) : (
          <>
            <div ref={profileRef} style={{position:"relative"}}>
              <button
                onClick={() => setProfileOpen(o => !o)}
                aria-label="Account menu"
                aria-expanded={profileOpen}
                style={{background:C.darkBrown,color:C.gold,border:`1.5px solid ${C.gold}88`,borderRadius:"50%",width:38,height:38,padding:0,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"0.9rem",fontWeight:900,flexShrink:0}}
              >
                {user.avatar
                  ? <img src={user.avatar} alt="" style={{width:"100%",height:"100%",borderRadius:"50%",objectFit:"cover"}}/>
                  : (user.fullName?.[0]?.toUpperCase() || "U")}
              </button>
              {profileOpen && (
                <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,background:"white",borderRadius:14,boxShadow:"0 10px 40px rgba(0,0,0,0.25)",padding:10,display:"flex",flexDirection:"column",gap:6,minWidth:210,zIndex:200}}>
                  <div style={{padding:"4px 8px 8px",borderBottom:"1px solid #f0f0f0",marginBottom:2}}>
                    <div style={{fontWeight:800,color:C.darkBrown,fontSize:"0.82rem"}}>{user.fullName}</div>
                    <div style={{color:"#999",fontSize:"0.68rem"}}>{accountLabel}</div>
                  </div>
                  {isBusiness ? (
                    <>
                      <button onClick={act(() => setShowBizDash(true))} style={menuItemStyle}>🏪 Business Dashboard</button>
                      <button onClick={act(() => setShowPayments(true))} style={menuItemStyle}>💳 Payments</button>
                    </>
                  ) : !isStaff ? (
                    <button onClick={act(() => setShowAccount(true))} style={menuItemStyle}>👤 My Account</button>
                  ) : null}
                  <button onClick={act(signOut)} style={{...menuItemStyle,color:"#dc2626"}}>⏻ Sign Out</button>
                </div>
              )}
            </div>
          </>
        )
      ) : (
        <>
          <button onClick={act(() => setAuthModal("login"))} style={{background:"transparent",color:"white",border:"1.5px solid rgba(255,255,255,0.4)",borderRadius:24,padding:"8px 16px",fontSize:"0.82rem",fontWeight:700,cursor:"pointer",width:stacked?"100%":"auto"}}>{T.login}</button>
          <button className="ah-auth-signup" onClick={act(() => setAuthModal("signup"))} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:24,padding:"8px 16px",fontSize:"0.82rem",fontWeight:900,cursor:"pointer",width:stacked?"100%":"auto"}}>{T.signup}</button>
        </>
      )}
    </>
  );

  return (
    <div style={{
      background: transparent ? "rgba(12,8,4,0.32)" : `linear-gradient(135deg,${C.darkBrown} 0%,${C.black} 50%,${C.kente3} 100%)`,
      backdropFilter: transparent ? "blur(14px)" : "none",
      WebkitBackdropFilter: transparent ? "blur(14px)" : "none",
      borderBottom: transparent ? "1px solid rgba(255,255,255,0.08)" : "none",
      padding: "0 20px", position: "sticky", top: "var(--ah-top-offset, 0px)", zIndex: 100,
      boxShadow: "0 2px 20px rgba(0,0,0,0.4)",
      transition: "background 0.3s ease, backdrop-filter 0.3s ease",
    }}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:4,background:`linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)`}}/>
      <div style={{maxWidth:1200,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:72,paddingTop:4,gap:16}}>
        <div className="ah-navbar-brand" style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",flexShrink:0,minWidth:0}} onClick={onLogoClick}>
          <img src={logoIcon} alt="AshantiHub" style={{height:44,width:"auto",display:"block",flexShrink:0}}/>
          <div style={{minWidth:0}}>
            <div style={{color:C.gold,fontWeight:900,fontSize:"1.15rem",letterSpacing:1,lineHeight:1,whiteSpace:"nowrap"}}>AshantiHub</div>
            <div className="ah-navbar-tagline" style={{color:C.lightGold,fontSize:"0.56rem",letterSpacing:2,opacity:0.8}}>THE MARKETPLACE OF ASHANTI</div>
          </div>
        </div>

        <div className="ah-navbar-links" style={{display:"flex",gap:6,alignItems:"center",justifyContent:"center",flex:1}}>
          <NavLinks/>
        </div>

        <div className="ah-navbar-utility" style={{display:"flex",gap:10,alignItems:"center",flexShrink:0}}>
          <UtilityActions/>
        </div>

        <button
          className="ah-navbar-hamburger"
          onClick={() => setMenuOpen(o => !o)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          style={{display:"none",background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:8,width:38,height:38,alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"1.15rem",flexShrink:0}}
        >
          {menuOpen ? "✕" : "☰"}
        </button>
      </div>

      {menuOpen && (
        <div className="ah-navbar-mobile-menu" style={{maxWidth:1200,margin:"0 auto",display:"flex",flexDirection:"column",gap:8,padding:"10px 0 18px",borderTop:"1px solid rgba(255,255,255,0.12)"}}>
          <NavLinks stacked/>
          <div style={{width:"100%",borderTop:"1px dashed rgba(255,255,255,0.15)",margin:"4px 0"}}/>
          <UtilityActions stacked/>
        </div>
      )}

      <style>{`
        .ah-nav-item:hover { border-color: ${C.gold} !important; box-shadow: 0 0 0 3px ${C.gold}22; }
        @media (max-width: ${NAV_BREAKPOINT}px) {
          .ah-navbar-links, .ah-navbar-utility { display: none !important; }
          /* Only beside the hamburger may the brand shrink (so 320px fits);
             wider, the links row would squeeze it to nothing. */
          .ah-navbar-brand { flex-shrink: 1 !important; }
          .ah-navbar-hamburger { display: flex !important; }
        }
        @media (min-width: ${NAV_BREAKPOINT + 1}px) {
          .ah-navbar-mobile-menu { display: none !important; }
        }
        /* Compact inline tier. Sign Up is dropped because the login modal
           has a Sign In / Sign Up tab switch. !important beats inline styles. */
        @media (min-width: ${NAV_BREAKPOINT + 1}px) and (max-width: ${COMPACT_MAX}px) {
          .ah-navbar-tagline, .ah-lang-label, .ah-auth-signup { display: none !important; }
          .ah-navbar-links .ah-nav-item { padding: 9px 12px !important; }
        }
      `}</style>
    </div>
  );
}

const utilityBtnStyle = {
  background: "rgba(255,255,255,0.1)",
  color: "white",
  border: "1px solid rgba(255,255,255,0.25)",
  borderRadius: 24,
  padding: "8px 14px",
  fontSize: "0.8rem",
  fontWeight: 700,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const menuItemStyle = {
  background: "#f6f6f6",
  color: C.darkBrown,
  border: "1px solid #e5e5e5",
  borderRadius: 12,
  padding: "8px 12px",
  fontSize: "0.78rem",
  fontWeight: 700,
  cursor: "pointer",
  textAlign: "left",
  fontFamily: "inherit",
};
