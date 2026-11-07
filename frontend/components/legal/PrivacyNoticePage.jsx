import { useEffect } from "react";
import { C } from "../../theme.js";
import { useSiteSettings } from "../../hooks/useSiteSettings.js";
import { BODY_FONT, HEADING_FONT } from "../storefront/storefrontType.js";
import { PRIVACY_GLANCE, PRIVACY_SECTIONS, PRIVACY_UPDATED } from "./privacyNotice.js";

// The Privacy Notice at /privacy. The words live in privacyNotice.js; this lays them out: a short summary, a contents
// list, the numbered sections, and a Contact section built from Site Settings (only the details a Super Admin has
// filled in are shown, nothing is invented). Reading page, so: one column about 70 characters wide, solid surfaces,
// body text in the ink colour, no decoration behind the words.

const contentsLink = (id) => (e) => {
  const target = document.getElementById(id);
  if (!target) return;
  e.preventDefault();
  target.scrollIntoView?.({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth", block: "start" });
  target.focus?.({ preventScroll: true });
};

function Block({ block, text }) {
  if (block.p) return <p style={text.p}>{block.p}</p>;
  if (block.ul) return <ul style={text.ul}>{block.ul.map((item) => <li key={item} style={{ marginBottom: 6 }}>{item}</li>)}</ul>;
  if (block.terms) {
    return (
      <dl style={{ margin: "12px 0 0" }}>
        {block.terms.map(([term, meaning]) => (
          <div key={term} style={{ padding: "12px 0", borderTop: `1px solid ${C.line}` }}>
            <dt style={{ fontWeight: 700, color: C.ink, marginBottom: 4 }}>{term}</dt>
            <dd style={{ margin: 0, color: C.ink, lineHeight: 1.65 }}>{meaning}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return null;
}

export default function PrivacyNoticePage({ onNavigate }) {
  const settings = useSiteSettings();
  const s = settings.data || {};

  useEffect(() => {
    const before = document.title;
    document.title = "Privacy Notice — AshantiHub";
    return () => { document.title = before; };
  }, []);

  const text = {
    p: { margin: "0 0 12px", lineHeight: 1.7, color: C.ink },
    ul: { margin: "0 0 12px", paddingLeft: 22, lineHeight: 1.65, color: C.ink, listStyle: "disc" },
  };
  const h2 = { margin: "0 0 10px", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "1.35rem", lineHeight: 1.2, letterSpacing: "-0.01em", color: C.ink };
  const contact = [
    s.contact_email && ["Email", s.contact_email, `mailto:${s.contact_email}`],
    s.contact_phone && ["Phone", s.contact_phone, `tel:${String(s.contact_phone).replace(/[^\d+]/g, "")}`],
    s.contact_address && ["Address", s.contact_address, null],
    s.support_hours && ["Support hours", s.support_hours, null],
  ].filter(Boolean);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "28px 16px 64px", boxSizing: "border-box", fontFamily: BODY_FONT, color: C.ink }}>
      <p style={{ margin: "0 0 6px" }}>
        <a href="/" onClick={(e) => { if (onNavigate) { e.preventDefault(); onNavigate("/"); } }} style={{ color: C.ink, fontWeight: 700, fontSize: "0.85rem", textDecoration: "underline" }}>{"← Back to AshantiHub"}</a>
      </p>
      <h1 style={{ margin: "8px 0 4px", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "clamp(1.9rem, 5vw, 2.5rem)", lineHeight: 1.1, letterSpacing: "-0.02em" }}>Privacy Notice</h1>
      <p style={{ margin: "0 0 20px", color: C.inkDim, fontSize: "0.9rem" }}>{`Last updated ${PRIVACY_UPDATED}`}</p>

      <section aria-labelledby="privacy-glance" style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: "16px 18px", marginBottom: 20 }}>
        <h2 id="privacy-glance" style={{ ...h2, fontSize: "1.1rem" }}>The short version</h2>
        <ul style={{ ...text.ul, marginBottom: 0 }}>
          {PRIVACY_GLANCE.map((line) => <li key={line} style={{ marginBottom: 6 }}>{line}</li>)}
        </ul>
      </section>

      <nav aria-label="Contents" style={{ marginBottom: 28 }}>
        <h2 style={{ ...h2, fontSize: "1.1rem" }}>Contents</h2>
        <ol style={{ margin: 0, paddingLeft: 26, lineHeight: 2, listStyle: "decimal" }}>
          {PRIVACY_SECTIONS.map((section) => (
            <li key={section.id}><a href={`#${section.id}`} onClick={contentsLink(section.id)} style={{ color: C.ink, textDecoration: "underline" }}>{section.title}</a></li>
          ))}
          <li><a href="#contact" onClick={contentsLink("contact")} style={{ color: C.ink, textDecoration: "underline" }}>Contact</a></li>
        </ol>
      </nav>

      {PRIVACY_SECTIONS.map((section, i) => (
        <section key={section.id} id={section.id} tabIndex={-1} aria-labelledby={`${section.id}-h`} style={{ marginBottom: 28, scrollMarginTop: "calc(var(--ah-top-offset, 0px) + var(--ah-header-h, 96px) + 12px)", outline: "none" }}>
          <h2 id={`${section.id}-h`} style={h2}>{`${i + 1}. ${section.title}`}</h2>
          {section.body.map((block, j) => <Block key={j} block={block} text={text} />)}
        </section>
      ))}

      <section id="contact" tabIndex={-1} aria-labelledby="contact-h" style={{ marginBottom: 12, scrollMarginTop: "calc(var(--ah-top-offset, 0px) + var(--ah-header-h, 96px) + 12px)", outline: "none" }}>
        <h2 id="contact-h" style={h2}>{`${PRIVACY_SECTIONS.length + 1}. Contact`}</h2>
        <p style={text.p}>Questions about this notice, or want to use one of your rights? Contact AshantiHub Support in the app, or:</p>
        {contact.length > 0 ? (
          <dl data-testid="privacy-contact" style={{ margin: 0 }}>
            {contact.map(([label, value, href]) => (
              <div key={label} style={{ display: "flex", gap: 12, padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
                <dt style={{ flex: "0 0 120px", fontWeight: 700 }}>{label}</dt>
                <dd style={{ margin: 0, minWidth: 0, overflowWrap: "anywhere" }}>{href ? <a href={href} style={{ color: C.ink, textDecoration: "underline" }}>{value}</a> : value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p style={{ ...text.p, color: C.inkDim }}>Use Contact Support in the app; it opens a conversation with AshantiHub Support.</p>
        )}
      </section>
    </main>
  );
}
