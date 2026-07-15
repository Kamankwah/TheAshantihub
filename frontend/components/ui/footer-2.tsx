import type { ComponentProps } from "react";
import { buttonVariants } from "@/components/ui/button";
import { useSiteSettings } from "@/hooks/useSiteSettings.js";

// lucide-react (installed here at v1.24.0) dropped its brand icon set a
// while back (trademark/scope reasons — Lucide is a general icon library,
// not a brand-icon one), so `FacebookIcon`/`InstagramIcon`/`LinkedinIcon`/
// `TwitterIcon` no longer exist as exports to import. These are small
// local stand-ins in the same stroke-based 24x24 style Lucide icons use
// (Lucide is itself a fork of Feather, which shipped these exact glyphs),
// so they render visually consistent with any other Lucide icon dropped
// into this button-icon slot.
function FacebookIcon(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

function InstagramIcon(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

function LinkedinIcon(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect x="2" y="9" width="4" height="12" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}

function TwitterIcon(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z" />
    </svg>
  );
}

type FooterLink = {
  label: string;
  onClick: () => void;
};

type FooterGroup = {
  title: string;
  links: FooterLink[];
};

type SocialLink = {
  name: string;
  icon: typeof FacebookIcon;
  href: string;
};

export type Footer2Props = {
  /** Local page-nav state setter — `AshantiHub`'s `page` state (no router yet). */
  setPage: (page: string) => void;
  /** Opens the signed-in business owner's dashboard (`showBizDash` flag in `AshantiHub`). */
  setShowBizDash: (open: boolean) => void;
  /** Opens the Terms/Privacy/Business Agreement modal — same convention as the old `Footer.jsx`. */
  setLegalDoc: (doc: "terms" | "privacy" | "business") => void;
};

// ─── Footer2 ─────────────────────────────────────────────────────────────
// shadcn `Footer2` block, adapted for AshantiHub (docs/UI_MODERNIZATION_ROADMAP.md
// Phase C). Replaces the plain-inline-style `components/Footer.jsx`. Contact
// info + social links are sourced live from Phase B's `useSiteSettings()`
// (`GET /api/core/site-settings/`), editable by staff via the Site Settings
// panel — nothing here is hardcoded/fabricated. Page nav + legal-doc links
// reuse the exact same `setPage`/`setLegalDoc` mechanisms as the rest of the
// (still router-less) app.
export function Footer2({ setPage, setShowBizDash, setLegalDoc }: Footer2Props) {
  const { data: settings } = useSiteSettings();
  const contactEmail = settings?.contact_email ?? "";
  const contactAddress = settings?.contact_address ?? "";

  const footerLinks: FooterGroup[] = [
    {
      title: "Company",
      links: [
        { label: "About", onClick: () => setPage("about") },
        { label: "Contact", onClick: () => setPage("contact") },
      ],
    },
    {
      title: "For Businesses",
      links: [
        { label: "Register Your Business", onClick: () => setPage("register") },
        { label: "Business Dashboard", onClick: () => setShowBizDash(true) },
      ],
    },
    {
      title: "Support",
      links: [
        { label: "Contact", onClick: () => setPage("contact") },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "Terms & Conditions", onClick: () => setLegalDoc("terms") },
        { label: "Privacy Notice", onClick: () => setLegalDoc("privacy") },
        { label: "Business Agreement", onClick: () => setLegalDoc("business") },
      ],
    },
  ];

  const socialLinks: SocialLink[] = [
    { name: "Facebook", icon: FacebookIcon, href: settings?.facebook_url ?? "" },
    { name: "Instagram", icon: InstagramIcon, href: settings?.instagram_url ?? "" },
    { name: "LinkedIn", icon: LinkedinIcon, href: settings?.linkedin_url ?? "" },
    { name: "Twitter", icon: TwitterIcon, href: settings?.twitter_url ?? "" },
  ].filter((social) => social.href !== "");

  return (
    <div className="shadcn-scope">
      <footer className="bg-card/60 border-t">
        <div className="max-w-6xl mx-auto px-4 lg:px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 py-8">
            {footerLinks.map((group) => (
              <div key={group.title}>
                <h3 className="text-sm font-semibold text-foreground mb-3">
                  {group.title}
                </h3>
                <ul className="space-y-2">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <button
                        type="button"
                        onClick={link.onClick}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors bg-transparent border-none p-0 cursor-pointer text-left"
                      >
                        {link.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="h-px bg-border" />

          <div className="py-5 flex flex-wrap items-center justify-between gap-4">
            <div className="text-xs text-muted-foreground">
              {contactAddress && <span>{contactAddress}</span>}
              {contactAddress && contactEmail && <span> • </span>}
              {contactEmail && <span>{contactEmail}</span>}
            </div>
            {socialLinks.length > 0 && (
              <div className="flex gap-2 items-center">
                {socialLinks.map((social) => (
                  <a
                    key={social.name}
                    href={social.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={social.name}
                    className={buttonVariants({ variant: "outline", size: "icon" })}
                  >
                    <social.icon className="size-5 text-muted-foreground" />
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="h-px bg-border" />

          <div className="text-center text-xs text-muted-foreground py-4">
            <p>© {new Date().getFullYear()} AshantiHub Ltd. All Rights Reserved</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
