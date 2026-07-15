import { motion } from "framer-motion";
import usePrefersReducedMotion from "@/hooks/usePrefersReducedMotion.js";

// ─── AboutTestimonialsSection ───────────────────────────────────────────
// A scroll-reveal grid of 5 fictional AshantiHub business-owner
// testimonials, flavored to the Ashanti/Kumasi context established in
// about-page.tsx's copy. No photo URLs (per product decision) — an
// initials-based avatar is rendered instead. Gated by
// usePrefersReducedMotion (Hero.jsx/SlideCarousel.jsx's shared hook): when
// true, content renders immediately visible with no animation, but the
// testimonials themselves always render regardless of motion preference.
type Testimonial = {
  quote: string;
  name: string;
  business: string;
  location: string;
};

const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "Before AshantiHub, my kente only sold to people who physically came to Bonwire. Now I get orders from Accra and from Ghanaians abroad every week — and being verified means customers trust me before we even speak.",
    name: "Akosua Boateng",
    business: "Boateng Kente Weaves",
    location: "Bonwire",
  },
  {
    quote:
      "I've sold waakye at the same spot in Bantama for twelve years, but no bank would ever look at me. My AshantiHub Business Credit Score finally got me a small loan to buy a second warmer.",
    name: "Comfort Adjei",
    business: "Auntie Comfort's Waakye",
    location: "Bantama",
  },
  {
    quote:
      "Suame Magazine has thousands of us doing incredible work, but customers outside the trade never knew who to call. My storefront on AshantiHub means people find my fabrication shop before they even reach the gate.",
    name: "Kwame Owusu",
    business: "Owusu Auto Fabrication",
    location: "Suame Magazine",
  },
  {
    quote:
      "Verification felt like a lot of paperwork at first, but it's exactly what made visitors trust our guesthouse enough to book from overseas without ever calling first.",
    name: "Yaa Asantewaa Mensah",
    business: "Golden Stool Guesthouse",
    location: "Kumasi",
  },
  {
    quote:
      "Trading at Kejetia, everything used to be word of mouth. Now customers browse my beads and baskets on their phone, message me on WhatsApp, and I still get to greet them like family when they come collect.",
    name: "Abena Serwaa",
    business: "Serwaa Crafts & Beads",
    location: "Kejetia",
  },
];

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const AVATAR_TONES = [
  "bg-primary text-primary-foreground",
  "bg-secondary text-secondary-foreground",
  "bg-accent text-accent-foreground",
];

export function AboutTestimonialsSection() {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div className="shadcn-scope">
      <div className="bg-muted/30 border-t border-b">
        <div className="max-w-5xl mx-auto px-4 py-14 lg:px-6">
          <h2 className="text-xl md:text-2xl font-bold text-foreground text-center mb-10">
            Businesses growing with AshantiHub
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t, i) => (
              <motion.div
                key={t.name}
                initial={reducedMotion ? undefined : { opacity: 0, y: 8 }}
                whileInView={reducedMotion ? undefined : { opacity: 1, y: 0 }}
                viewport={reducedMotion ? undefined : { once: true }}
                transition={reducedMotion ? undefined : { duration: 0.4, delay: i * 0.08 }}
                className="bg-card border rounded-xl p-5 flex flex-col gap-4"
              >
                <p className="text-sm text-muted-foreground leading-relaxed italic">
                  "{t.quote}"
                </p>
                <div className="flex items-center gap-3 mt-auto">
                  <div
                    className={`size-10 rounded-full flex items-center justify-center text-sm font-bold ${AVATAR_TONES[i % AVATAR_TONES.length]}`}
                    aria-hidden="true"
                  >
                    {initials(t.name)}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">{t.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.business} • {t.location}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
