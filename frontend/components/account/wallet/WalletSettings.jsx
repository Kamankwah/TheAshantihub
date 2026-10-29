import { Link } from "react-router-dom";
import { useAddresses } from "../../../hooks/useAddresses.js";
import { walletStyles } from "../../wallet/walletStyles.js";
import { ACCOUNT_ROOT } from "../accountNav.js";
import { HEADING_FONT } from "../../storefront/storefrontType.js";

// Your Payments > Settings: "Your default purchase preference". The default delivery
// address is the default CustomerAddress; the payment method is never saved (no model), so
// the card says so in one line. No back-up payment method and no default-method control.
export default function WalletSettings() {
  const s = walletStyles("light");
  const { data, isLoading, error } = useAddresses();
  const rows = Array.isArray(data) ? data : [];
  const def = rows.find((a) => a.is_default) || null;
  const row = { display: "grid", gap: 4, padding: "12px 0", borderTop: s.card.border };
  const link = { ...s.note, textDecoration: "underline" };
  return (
    <section aria-label="Your default purchase preference" style={s.card}>
      <h2 style={{ margin: "0 0 8px", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "1.1rem" }}>Your default purchase preference</h2>
      <div style={row}>
        <div style={s.label}>Default delivery address</div>
        {isLoading ? <div style={s.note}>Loading…</div>
          : error ? <div role="alert" style={s.error}>We could not load your addresses.</div>
          : def ? (
            <>
              <div style={s.value}>{def.recipient_name}{def.label ? ` · ${def.label}` : ""}</div>
              <div style={s.value}>{def.gps_address}</div>
              {def.landmark && <div style={s.note}>{def.landmark}</div>}
            </>
          ) : <div style={s.note}>No default address yet — add one</div>}
        <div><Link to={`${ACCOUNT_ROOT}/addresses`} style={link}>{def ? "Update" : "Add an address"}</Link></div>
      </div>
      <div style={row}>
        <div style={s.label}>Payment method</div>
        <div style={s.note}>Not saved: you choose mobile money or your wallet at checkout.</div>
      </div>
      <div style={row}>
        <Link to={`${ACCOUNT_ROOT}/security`} style={link}>Login &amp; security</Link>
      </div>
    </section>
  );
}
