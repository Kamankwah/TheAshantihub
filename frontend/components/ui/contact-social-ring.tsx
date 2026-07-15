import { motion } from "framer-motion";
import { useSiteSettings } from "@/hooks/useSiteSettings.js";
import usePrefersReducedMotion from "@/hooks/usePrefersReducedMotion.js";
import {
  FacebookIcon,
  InstagramIcon,
  LinkedinIcon,
  TwitterIcon,
  TiktokIcon,
  YoutubeIcon,
  WhatsappIcon,
} from "@/components/ui/social-icons.tsx";

// ─── ContactSocialRing ───────────────────────────────────────────────────
// A centered AshantiHub brand badge with the configured social/WhatsApp
// links arranged in an orbiting ring around it. Self-contained (calls
// useSiteSettings() itself, same convention as Footer2/ContactCtaBand).
// Deliberately doesn't import Flag from App.jsx — that would create a
// circular components/ui -> App.jsx import — so the brand mark here is a
// plain emoji + text badge instead.
type Platform = {
  name: string;
  icon: typeof FacebookIcon;
  href: string;
};

const RING_RADIUS = 110; // px

export function ContactSocialRing() {
  const { data: settings } = useSiteSettings();
  const reducedMotion = usePrefersReducedMotion();

  const platforms: Platform[] = [
    { name: "Facebook", icon: FacebookIcon, href: settings?.facebook_url ?? "" },
    { name: "Instagram", icon: InstagramIcon, href: settings?.instagram_url ?? "" },
    { name: "LinkedIn", icon: LinkedinIcon, href: settings?.linkedin_url ?? "" },
    { name: "Twitter", icon: TwitterIcon, href: settings?.twitter_url ?? "" },
    { name: "TikTok", icon: TiktokIcon, href: settings?.tiktok_url ?? "" },
    { name: "YouTube", icon: YoutubeIcon, href: settings?.youtube_url ?? "" },
    {
      name: "WhatsApp",
      icon: WhatsappIcon,
      href: settings?.whatsapp_number ? `https://wa.me/${settings.whatsapp_number}` : "",
    },
  ].filter((p) => p.href !== "");

  const badge = (
    <div className="size-24 rounded-full bg-primary text-primary-foreground flex flex-col items-center justify-center shadow-lg z-10">
      <span className="text-2xl leading-none">👑</span>
      <span className="text-[0.6rem] font-bold tracking-wide mt-1">AshantiHub</span>
    </div>
  );

  return (
    <div className="shadcn-scope">
      <div className="relative flex items-center justify-center h-72 w-full">
        {platforms.length === 0 ? (
          badge
        ) : (
          <>
            <motion.div
              className="absolute size-full"
              animate={reducedMotion ? undefined : { rotate: 360 }}
              transition={reducedMotion ? undefined : { repeat: Infinity, duration: 20, ease: "linear" }}
            >
              {platforms.map((p, i) => {
                const angle = (2 * Math.PI * i) / platforms.length;
                const x = Math.cos(angle) * RING_RADIUS;
                const y = Math.sin(angle) * RING_RADIUS;
                return (
                  <motion.div
                    key={p.name}
                    className="absolute top-1/2 left-1/2"
                    style={{ transform: `translate(${x}px, ${y}px)` }}
                    animate={reducedMotion ? undefined : { rotate: -360 }}
                    transition={reducedMotion ? undefined : { repeat: Infinity, duration: 20, ease: "linear" }}
                  >
                    <a
                      href={p.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={p.name}
                      className="flex items-center justify-center size-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-card border shadow-sm hover:bg-accent transition-colors"
                    >
                      <p.icon className="size-5 text-muted-foreground" />
                    </a>
                  </motion.div>
                );
              })}
            </motion.div>
            {badge}
          </>
        )}
      </div>
    </div>
  );
}
