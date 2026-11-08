import { useEffect } from "react";
import { C } from "../../theme.js";
import { BODY_FONT, HEADING_FONT } from "../storefront/storefrontType.js";
import { BUSINESS_TERMS_COPY, BUSINESS_TERMS_VERSION } from "../businessTerms.js";

// The footer's "Terms & Conditions" (/terms) and "Business Agreement" (/business-agreement) pages.
//  - Business Agreement: the exact text every business owner accepts when they register or claim a listing
//    (businessTerms.js, the same constant those screens show), with the version the server records.
//  - Terms & Conditions: the full customer and wallet terms are still a draft awaiting legal review (they are not in
//    force), so this page says so plainly instead of publishing a draft, and points to what does apply today. When
//    the reviewed terms exist, replace TERMS_NOTICE with them; nothing else needs to change.
// Reading page, same layout rules as the Privacy Notice: one column, solid surfaces, ink text.

const TERMS_NOTICE = [
  "Our full Terms and Conditions for customers and sellers are being finalised with our lawyers and are not published yet. We do not want to show you a draft as if it were in force.",
  "Until they are published: if you sell on AshantiHub, the Business Agreement applies and you accept it when you register. How we handle your personal data is set out in the Privacy Notice. For anything about an order, a payment or a listing, contact AshantiHub Support.",
];

function businessSections() {
  const [, ...rest] = BUSINESS_TERMS_COPY.split("\n\n");
  return rest.map((block) => {
    const m = block.match(/^(\d+)\.\s+([^—]+?)\s+—\s+([\s\S]*)$/);
    return m ? { n: m[1], title: m[2], text: m[3] } : { n: "", title: "", text: block };
  });
}

export default function LegalDocPage({ kind, onNavigate, onSupport }) {
  const business = kind === "business";
  const title = business ? "Business Agreement" : "Terms & Conditions";

  useEffect(() => {
    const before = document.title;
    document.title = `${title} — AshantiHub`;
    return () => { document.title = before; };
  }, [title]);

  const link = { color: C.ink, textDecoration: "underline", fontWeight: 700 };
  const go = (path) => (e) => { if (onNavigate && !(e.metaKey || e.ctrlKey || e.shiftKey)) { e.preventDefault(); onNavigate(path); } };
  const p = { margin: "0 0 12px", lineHeight: 1.7, color: C.ink };

  return (
    <main id="main-content" style={{ maxWidth: 720, margin: "0 auto", padding: "28px 16px 64px", boxSizing: "border-box", fontFamily: BODY_FONT, color: C.ink }}>
      <p style={{ margin: "0 0 6px" }}>
        <a href="/" onClick={go("/")} style={{ ...link, fontSize: "0.85rem" }}>{"← Back to AshantiHub"}</a>
      </p>
      <h1 style={{ margin: "8px 0 4px", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "clamp(1.9rem, 5vw, 2.5rem)", lineHeight: 1.1, letterSpacing: "-0.02em" }}>{title}</h1>

      {business ? (
        <>
          <p style={{ margin: "0 0 20px", color: C.inkDim, fontSize: "0.9rem" }}>{`Version ${BUSINESS_TERMS_VERSION}. A summary of what every business owner accepts when registering.`}</p>
          {businessSections().map((s) => (
            <section key={s.n || s.text.slice(0, 12)} style={{ marginBottom: 20 }}>
              {s.title && <h2 style={{ margin: "0 0 6px", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "1.2rem", color: C.ink }}>{`${s.n}. ${s.title}`}</h2>}
              <p style={p}>{s.text}</p>
            </section>
          ))}
        </>
      ) : (
        <>
          <p style={{ margin: "0 0 20px", color: C.inkDim, fontSize: "0.9rem" }}>Not yet published</p>
          {TERMS_NOTICE.map((line) => <p key={line} style={p}>{line}</p>)}
        </>
      )}

      <nav aria-label="Related documents" style={{ marginTop: 28, borderTop: `1px solid ${C.line}`, paddingTop: 16 }}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
          <li><a href="/privacy" onClick={go("/privacy")} style={{ ...link, display: "inline-flex", alignItems: "center", minHeight: 44 }}>Privacy Notice</a></li>
          {business ? null : <li><a href="/business-agreement" onClick={go("/business-agreement")} style={{ ...link, display: "inline-flex", alignItems: "center", minHeight: 44 }}>Business Agreement (for sellers)</a></li>}
          {onSupport && <li><button type="button" onClick={onSupport} style={{ ...link, background: "none", border: "none", padding: 0, minHeight: 44, cursor: "pointer", fontFamily: "inherit", fontSize: "inherit" }}>Contact AshantiHub Support</button></li>}
        </ul>
      </nav>
    </main>
  );
}
