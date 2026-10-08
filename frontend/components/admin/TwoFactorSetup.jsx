import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { saveBlob } from "../../lib/saveBlob.js";
import { button, codeField } from "./panels/panelStyles.js";
import { D } from "./theme.js";

const mono = "'JetBrains Mono', ui-monospace, monospace";
const text = { color: D.text, fontSize: "0.8rem", lineHeight: 1.5 };

// Codes are typed with spaces ("123 456"); the server wants the bare string.
export const bareCode = (value) => value.replace(/\s/g, "");

// Scan the QR code (drawn on the device; the secret never goes to a QR
// service) or type the key, then confirm with the first 6-digit code.
export function TwoFactorSetup({ secret, otpauthUri, onConfirm, busy, error }) {
  const [qr, setQr] = useState(null);
  const [code, setCode] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toString(otpauthUri, { type: "svg", errorCorrectionLevel: "M", margin: 2 })
      .then((svg) => { if (live) setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`); })
      .catch(() => { if (live) setQr(null); });
    return () => { live = false; };
  }, [otpauthUri]);
  const ready = /^\d{6}$/.test(bareCode(code));
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ready && !busy) onConfirm(bareCode(code)); }} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={text}>Open an authenticator app (Google Authenticator, Microsoft Authenticator or similar) and scan this code.</div>
      {qr && <img src={qr} alt="QR code for your authenticator app" width={168} height={168} style={{ background: D.panelBg, borderRadius: 8, alignSelf: "flex-start" }} />}
      <div style={text}>
        Can't scan it? Type this key into the app.
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <label htmlFor="two-factor-setup-key" style={{ fontWeight: 700 }}>Setup key</label>
          <output id="two-factor-setup-key" style={{ fontFamily: mono, fontWeight: 700 }}>{secret.replace(/(.{4})/g, "$1 ").trim()}</output>
        </div>
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem", fontWeight: 700, color: D.text }}>
        6-digit code from the app
        <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} style={codeField} />
      </label>
      {error && <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>{error}</div>}
      <button type="submit" disabled={busy || !ready} style={{ ...button(D.gold, D.text, busy || !ready), alignSelf: "flex-start" }}>Turn on 2-step sign-in</button>
    </form>
  );
}

// The 10 single-use recovery codes, shown once.
export function RecoveryCodes({ codes, onDone, doneLabel = "Done" }) {
  const [saved, setSaved] = useState(false);
  const [copyState, setCopyState] = useState(null);
  const download = () => saveBlob(
    new Blob([`AshantiHub recovery codes. Each one works once.\n\n${codes.join("\n")}\n`], { type: "text/plain" }),
    "ashantihub-recovery-codes.txt",
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopyState("ok");
    } catch {
      setCopyState("failed");
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.9rem" }}>Save your recovery codes</div>
      <div style={text}>If you lose your phone, each code signs you in once. Keep them somewhere other than the phone. You won't see them again.</div>
      <ol aria-label="Recovery codes" style={{ fontFamily: mono, fontSize: "0.85rem", columns: 2, margin: 0, paddingLeft: 22, color: D.text, background: D.panelBg2, borderRadius: 10, paddingTop: 8, paddingBottom: 8 }}>
        {codes.map((code) => <li key={code}>{code}</li>)}
      </ol>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={download} style={button(D.panelBg, D.text)}>Download</button>
        <button type="button" onClick={copy} style={button(D.panelBg, D.text)}>Copy</button>
      </div>
      {copyState === "ok" && <div role="status" style={{ color: D.text, fontSize: "0.78rem" }}>Copied.</div>}
      {copyState === "failed" && <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>Could not copy. Use Download instead.</div>}
      <label style={{ display: "flex", gap: 8, alignItems: "center", ...text }}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I've saved these codes
      </label>
      <button type="button" disabled={!saved} onClick={onDone} style={{ ...button(D.gold, D.text, !saved), alignSelf: "flex-start" }}>{doneLabel}</button>
    </div>
  );
}
