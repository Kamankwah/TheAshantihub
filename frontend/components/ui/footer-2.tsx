import { buttonVariants } from "@/components/ui/button";
import { useSiteSettings } from "@/hooks/useSiteSettings.js";
import {
  FacebookIcon,
  InstagramIcon,
  LinkedinIcon,
  TwitterIcon,
  TiktokIcon,
  YoutubeIcon,
  WhatsappIcon,
} from "@/components/ui/social-icons.tsx";

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
    { name: "TikTok", icon: TiktokIcon, href: settings?.tiktok_url ?? "" },
    { name: "YouTube", icon: YoutubeIcon, href: settings?.youtube_url ?? "" },
    { name: "WhatsApp", icon: WhatsappIcon, href: settings?.whatsapp_number ? `https://wa.me/${settings.whatsapp_number}` : "" },
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
