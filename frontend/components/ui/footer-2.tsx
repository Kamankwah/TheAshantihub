export type Footer2Props = {
  /** Local page-nav state setter — `AshantiHub`'s `page` state (no router yet). */
  setPage: (page: string) => void;
  /** Opens the Terms/Privacy/Business Agreement modal. */
  setLegalDoc: (doc: "terms" | "privacy" | "business") => void;
  /** Opens the Support intake (the same one the floating chat button opens). */
  onSupport: () => void;
};

type FooterLink = { label: string; onClick: () => void };

// ─── Footer2 ─────────────────────────────────────────────────────────────
// Marketplace footer (Plan M1 task 11): a "Back to top" bar over a dark
// brown band. The only links are Support, About us and Contact, plus the
// legal documents. No phone, email, address, social or business-contact
// text anywhere (the Contact page is a message form; AshantiHub Support is
// reached through the intake). Nothing here comes from SiteSettings.
export function Footer2({ setPage, setLegalDoc, onSupport }: Footer2Props) {
  const help: FooterLink[] = [
    { label: "Support", onClick: onSupport },
    { label: "About us", onClick: () => setPage("about") },
    { label: "Contact", onClick: () => setPage("contact") },
  ];
  const legal: FooterLink[] = [
    { label: "Terms & Conditions", onClick: () => setLegalDoc("terms") },
    { label: "Privacy Notice", onClick: () => setLegalDoc("privacy") },
    { label: "Business Agreement", onClick: () => setLegalDoc("business") },
  ];
  const linkClass =
    "text-sm text-[#FDF6E3]/80 hover:text-[#FDF6E3] hover:underline bg-transparent border-none p-0 cursor-pointer text-left min-h-6";

  return (
    <div className="shadcn-scope">
      <footer>
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="w-full bg-[#4a3226] hover:bg-[#5a3d2f] text-[#FDF6E3] text-sm font-semibold py-3 border-none cursor-pointer"
        >
          Back to top
        </button>
        <div className="bg-[#2C1810]">
          <nav aria-label="Footer" className="max-w-6xl mx-auto px-4 lg:px-6 py-10 flex flex-wrap gap-x-16 gap-y-8">
            <ul className="space-y-2 list-none p-0 m-0">
              {help.map((l) => (
                <li key={l.label}>
                  <button type="button" onClick={l.onClick} className={linkClass}>{l.label}</button>
                </li>
              ))}
            </ul>
            <ul className="space-y-2 list-none p-0 m-0">
              {legal.map((l) => (
                <li key={l.label}>
                  <button type="button" onClick={l.onClick} className={linkClass}>{l.label}</button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="border-t border-[#FDF6E3]/15 text-center text-xs text-[#FDF6E3]/70 py-4">
            <p>© {new Date().getFullYear()} AshantiHub Ltd. All Rights Reserved</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
