// ─── AboutPage ───────────────────────────────────────────────────────────
// The About tab's main narrative content (hero/story/what-we-do/mission/
// values), replacing the old hardcoded hero+4-cards block in App.jsx's
// page==="about" block. Fully static, no data fetching — same convention
// as about-cta-band.tsx (Tailwind + shadcn CSS-variable tokens,
// .shadcn-scope wrap). AboutTestimonialsSection/AboutFaqSection/
// AboutCtaBand render after this, still each their own file/App.jsx block.
const VALUES = [
  {
    emoji: "🤝",
    title: "Trust",
    body: "Every business is verified. Ghana Card, digital address and physical confirmation. No exceptions.",
  },
  {
    emoji: "👑",
    title: "Culture",
    body: "We are proudly Ashanti. Built for Asanteman, by Asanteman.",
  },
  {
    emoji: "📈",
    title: "Empowerment",
    body: "We measure success by the businesses that grow, the loans unlocked and the jobs created.",
  },
  {
    emoji: "🌍",
    title: "Connection",
    body: "Bridging Kumasi to the world, and the diaspora back home.",
  },
];

export function AboutPage() {
  return (
    <div className="shadcn-scope">
      <div className="max-w-3xl mx-auto px-4 py-14 lg:px-6">
        {/* Hero */}
        <div className="text-center mb-14">
          <h1 className="text-3xl md:text-4xl font-extrabold text-foreground tracking-tight mb-2">
            About AshantiHub 👑
          </h1>
          <p className="text-primary font-semibold mb-4">The Marketplace of Ashanti</p>
          <p className="text-muted-foreground leading-relaxed max-w-2xl mx-auto">
            AshantiHub is the digital home of Ashanti commerce — one platform
            connecting the businesses of Kumasi and the Ashanti Region to
            customers at home and across the world.
          </p>
        </div>

        {/* Our Story */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-foreground mb-4">Our Story</h2>
          <div className="space-y-4 text-muted-foreground leading-relaxed">
            <p>
              The Ashanti Region has always been the commercial heartbeat of
              Ghana. Long before the internet, Kumasi was a crossroads of
              trade — gold, kente, crafts and commerce flowing through the
              greatest market civilisation in West Africa.
            </p>
            <p>
              Yet today, over 400,000 businesses across our region remain
              digitally invisible. The tomato farmer in Akomadan. The kente
              weaver in Bonwire. The waakye seller in Bantama. The TZ chop
              bar owner in Alabar. The artisans of Suame Magazine — 200,000
              strong, the largest industrial cluster in West Africa. The
              traders across the length and breadth of Kejetia and Adum.
            </p>
            <p>
              These businesses have served their communities faithfully for
              generations — but the world could not find them, and the
              banks could not see them.
            </p>
            <p className="text-foreground font-semibold">
              AshantiHub was built to change that.
            </p>
          </div>
        </section>

        {/* What We Do */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-foreground mb-4">What We Do</h2>
          <div className="space-y-4 text-muted-foreground leading-relaxed">
            <p>
              We give every business in the Ashanti Region — formal or
              informal, large or small — a verified digital storefront with
              photos, prices, reviews and instant WhatsApp connection to
              customers.
            </p>
            <p>
              For businesses, we deliver customers from across Ghana and
              the diaspora, delivery coordination to get products anywhere,
              and something no bank has ever offered the informal sector —
              a Business Credit Score built from real trading behaviour,
              opening the door to loans from our financial institution
              partners.
            </p>
            <p>
              For customers, we offer the trusted way to discover, connect
              and transact with verified Ashanti businesses — whether
              you're in Ahodwo or Amsterdam, Santasi or Seattle.
            </p>
          </div>
        </section>

        {/* Our Mission */}
        <section className="mb-14 bg-muted/50 rounded-xl p-6 md:p-8 border">
          <h2 className="text-xl font-bold text-foreground mb-3">Our Mission</h2>
          <p className="text-muted-foreground leading-relaxed">
            To digitise the informal economy of Asanteman — expanding
            customer bases, unlocking access to credit, and creating jobs
            across the region, with women entrepreneurs at the centre of
            everything we do.
          </p>
        </section>

        {/* Our Values */}
        <section>
          <h2 className="text-xl font-bold text-foreground mb-6">Our Values</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {VALUES.map((v) => (
              <div key={v.title} className="bg-card border rounded-xl p-5">
                <div className="text-2xl mb-2">{v.emoji}</div>
                <h3 className="font-bold text-foreground mb-1">{v.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{v.body}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
