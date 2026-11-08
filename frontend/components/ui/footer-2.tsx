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
// Marketplace footer: a "Back to top" bar over a dark brown band. Links to Support, About us, Contact and the legal
// documents, plus a "Reach AshantiHub" column built from the saved Site Settings (email, phone, address, support
// hours, WhatsApp and social links). Only fields a Super Admin has filled in are shown; nothing is invented, and the
// column disappears while the settings are empty or loading. These are AshantiHub's own details, never a business's
// (businesses cannot be contacted directly), so a WhatsApp link here points at AshantiHub itself.
const webUrl = (v?: string) => (typeof v === "string" && /^https?:\/\//i.test(v.trim()) ? v.trim() : "");

export function Footer2({ setPage, setLegalDoc, onSupport }: Footer2Props) {
  const { data: settings } = useSiteSettings();
  const email = (settings?.contact_email || "").trim();
  const phone = (settings?.contact_phone || "").trim();
  const address = (settings?.contact_address || "").trim();
  const hours = (settings?.support_hours || "").trim();
  const whatsapp = String(settings?.whatsapp_number || "").replace(/[^\d]/g, "");
  const socials = [
    { name: "Facebook", icon: FacebookIcon, href: webUrl(settings?.facebook_url) },
    { name: "Instagram", icon: InstagramIcon, href: webUrl(settings?.instagram_url) },
    { name: "LinkedIn", icon: LinkedinIcon, href: webUrl(settings?.linkedin_url) },
    { name: "Twitter", icon: TwitterIcon, href: webUrl(settings?.twitter_url) },
    { name: "TikTok", icon: TiktokIcon, href: webUrl(settings?.tiktok_url) },
    { name: "YouTube", icon: YoutubeIcon, href: webUrl(settings?.youtube_url) },
    { name: "WhatsApp", icon: WhatsappIcon, href: whatsapp ? `https://wa.me/${whatsapp}` : "" },
  ].filter((p) => p.href);
  const hasReach = Boolean(email || phone || address || hours || socials.length);

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
    "text-sm text-[#FDF6E3]/80 hover:text-[#FDF6E3] hover:underline bg-transparent border-none p-0 cursor-pointer text-left min-h-11 inline-flex items-center";

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
            <ul className="space-y-0 list-none p-0 m-0">
              {help.map((l) => (
                <li key={l.label}>
                  <button type="button" onClick={l.onClick} className={linkClass}>{l.label}</button>
                </li>
              ))}
            </ul>
            <ul className="space-y-0 list-none p-0 m-0">
              {legal.map((l) => (
                <li key={l.label}>
                  <button type="button" onClick={l.onClick} className={linkClass}>{l.label}</button>
                </li>
              ))}
            </ul>
          </nav>
          {hasReach && (
            <section aria-label="Reach AshantiHub" className="max-w-6xl mx-auto px-4 lg:px-6 pb-8 -mt-2 text-sm text-[#FDF6E3]/80">
              <h2 className="text-sm font-semibold text-[#FDF6E3] mb-2 font-sans">Reach AshantiHub</h2>
              <ul className="list-none p-0 m-0 flex flex-col gap-1">
                {email && <li><a href={`mailto:${email}`} className="underline underline-offset-2 hover:text-[#FDF6E3] inline-flex items-center min-h-11 break-all">{email}</a></li>}
                {phone && <li><a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="underline underline-offset-2 hover:text-[#FDF6E3] inline-flex items-center min-h-11">{phone}</a></li>}
                {address && <li className="whitespace-pre-line">{address}</li>}
                {hours && <li>Support hours: {hours}</li>}
              </ul>
              {socials.length > 0 && (
                <ul className="list-none p-0 m-0 mt-2 flex flex-wrap gap-1">
                  {socials.map((p) => (
                    <li key={p.name}>
                      <a href={p.href} target="_blank" rel="noreferrer noopener" aria-label={p.name} className="inline-flex items-center justify-center size-11 rounded-full hover:bg-[#FDF6E3]/10 text-[#FDF6E3]">
                        <p.icon className="size-5" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          <div className="border-t border-[#FDF6E3]/15 text-center text-xs text-[#FDF6E3]/70 pt-4 pb-20">
            <p>© {new Date().getFullYear()} AshantiHub Ltd. All Rights Reserved</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
