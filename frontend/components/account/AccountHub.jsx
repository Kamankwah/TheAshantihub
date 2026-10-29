import { Link, useLocation } from "react-router-dom";
import { D, glassCard } from "../dashboard/theme.js";
import { HEADING_FONT } from "../storefront/storefrontType.js";
import { ACCOUNT_ROOT, ACCOUNT_TILES, PAYMENT_TABS, parseAccountPath } from "./accountNav.js";
import CustomerService from "./CustomerService.jsx";
import LoginSecurity from "./LoginSecurity.jsx";
import SellOnAshantiHub from "./SellOnAshantiHub.jsx";
import YourLists from "./YourLists.jsx";
import YourOrders from "./YourOrders.jsx";
import WalletTabs from "./wallet/WalletTabs.jsx";
import YourAddresses from "./YourAddresses.jsx";

const crumbLink = { color: D.textDim, textDecoration: "none", fontWeight: 600 };

function Breadcrumb({ trail }) {
  return (
    <nav aria-label="Breadcrumb" style={{ fontSize: "0.78rem", color: D.textFaint, marginBottom: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
      {trail.map((c, i) => (
        <span key={c.label} style={{ display: "inline-flex", gap: 6 }}>
          {i > 0 && <span aria-hidden="true">›</span>}
          {c.to ? <Link to={c.to} style={crumbLink}>{c.label}</Link> : <span aria-current="page" style={{ color: D.text, fontWeight: 700 }}>{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}

function Hub({ overview }) {
  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div className="ah-account-tiles" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
        {ACCOUNT_TILES.map((t) => (
          <Link key={t.id} to={t.path} data-testid="account-tile" style={{ ...glassCard, padding: 18, display: "flex", gap: 14, alignItems: "flex-start", textDecoration: "none", color: "inherit", minHeight: 96 }}>
            <span aria-hidden="true" style={{ fontSize: "1.7rem", lineHeight: 1 }}>{t.icon}</span>
            <span>
              <h2 style={{ margin: "0 0 4px", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "1.05rem", color: D.text }}>{t.title}</h2>
              <span style={{ color: D.textDim, fontSize: "0.8rem", lineHeight: 1.5 }}>{t.text}</span>
            </span>
          </Link>
        ))}
      </div>
      {overview}
      <style>{`@media (max-width: 900px) { .ah-account-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } } @media (max-width: 560px) { .ah-account-tiles { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

const TITLES = Object.fromEntries(ACCOUNT_TILES.map((t) => [t.id, t.title]));

// The Your Account hub and its URL-addressable sections (/my-account/<section>,
// /my-account/payments/<tab>). It owns routing and layout only: every App-owned piece
// (the order, booking, request, ticket, event, saved, settings and messaging tabs) arrives
// in `render` as a function returning a node, because components/** never import App.jsx.
export default function AccountHub({ user, auth, render = {}, onContactSupport, onOpenPage, onStartRegistration }) {
  const { pathname } = useLocation();
  const { section, tab } = parseAccountPath(pathname);

  const trail = [{ label: "Your Account", to: section ? ACCOUNT_ROOT : null }];
  if (section) {
    const sectionLabel = TITLES[section];
    if (section === "payments") {
      trail.push({ label: sectionLabel, to: null });
      trail[1].to = `${ACCOUNT_ROOT}/payments/overview`;
      trail.push({ label: PAYMENT_TABS.find((p) => p.id === tab)?.label ?? "Overview", to: null });
    } else {
      trail.push({ label: sectionLabel, to: null });
    }
  }

  let body;
  switch (section) {
    case "orders": body = <YourOrders render={render} />; break;
    case "security": body = <LoginSecurity user={user} auth={auth} render={render} />; break;
    case "addresses": body = <YourAddresses />; break;
    case "payments": body = <WalletTabs tab={tab} bodies={render.payments} />; break;
    case "lists": body = <YourLists user={user} />; break;
    case "messages": body = render.messages?.(); break;
    case "help": body = <CustomerService onContactSupport={onContactSupport} onOpenPage={onOpenPage} />; break;
    case "sell": body = <SellOnAshantiHub user={user} auth={auth} onStart={onStartRegistration} />; break;
    default: body = <Hub overview={render.overview?.()} />;
  }

  return (
    <div>
      <Breadcrumb trail={trail} />
      {section && <h1 style={{ margin: "0 0 18px", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "1.6rem", letterSpacing: "-0.02em", color: D.text }}>{TITLES[section]}</h1>}
      {!section && <h1 style={{ margin: "0 0 18px", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "1.6rem", letterSpacing: "-0.02em", color: D.text }}>Your Account</h1>}
      {body}
    </div>
  );
}
