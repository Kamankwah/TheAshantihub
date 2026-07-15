import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── AboutFaqSection ─────────────────────────────────────────────────────
// A hand-built accordion (no Radix Accordion dependency is installed, and
// none is needed for this small a micro-interaction) — a local
// `openIndex` state, question buttons with a rotating ChevronDown, and a
// conditionally-rendered answer. The "can I contact a business directly"
// answer below deliberately mirrors this app's real, already-implemented
// no-direct-contact policy (see CLAUDE.md's "Businesses cannot be
// contacted directly" note) rather than inventing different behavior.
type Faq = { question: string; answer: string };

const FAQS: Faq[] = [
  {
    question: "How does a business get verified on AshantiHub?",
    answer:
      "Every business goes through a verification check before it can list: a valid Ghana Card, a registered digital address, and a physical confirmation of the business. This is the same Trust standard behind everything we do — no exceptions.",
  },
  {
    question: "Is AshantiHub free for businesses to join?",
    answer:
      "Yes — creating a verified storefront on AshantiHub is free. Optional paid add-ons (like Hero placement or Featured/Boost promotions) exist for businesses that want extra visibility, but a standard listing costs nothing to set up.",
  },
  {
    question: "How does the Business Credit Score work?",
    answer:
      "As your business trades on AshantiHub — listings, orders, reviews and activity over time — we build a Business Credit Score from that real trading behaviour. It's designed to open the door to loans from our financial institution partners, especially for informal businesses banks have historically overlooked.",
  },
  {
    question: "Can I contact a business directly through AshantiHub?",
    answer:
      "No — for everyone's safety, AshantiHub doesn't allow direct messaging or WhatsApp contact with a business. Instead, use \"Contact Support\" on any listing and AshantiHub Support will help connect you and coordinate the enquiry on your behalf.",
  },
  {
    question: "How do I register my business?",
    answer:
      "Tap \"Register Your Business\" from the About or Business page, follow the guided form (business details, category, zone and verification documents), and our team will review and verify your submission before it goes live.",
  },
  {
    question: "How does WhatsApp ordering/connection work for a listing?",
    answer:
      "Product and service listings support Add to Cart and checkout directly in-app. For anything else, \"Contact Support\" opens a conversation with AshantiHub Support (not the business) about that listing — we relay the enquiry rather than exposing a direct line.",
  },
];

export function AboutFaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="shadcn-scope">
      <div className="max-w-3xl mx-auto px-4 py-14 lg:px-6">
        <h2 className="text-xl md:text-2xl font-bold text-foreground text-center mb-8">
          Frequently Asked Questions
        </h2>
        <div className="divide-y border rounded-xl overflow-hidden bg-card">
          {FAQS.map((faq, i) => {
            const open = openIndex === i;
            return (
              <div key={faq.question}>
                <button
                  type="button"
                  onClick={() => setOpenIndex(open ? null : i)}
                  aria-expanded={open}
                  className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left bg-transparent border-none cursor-pointer"
                >
                  <span className="text-sm font-semibold text-foreground">{faq.question}</span>
                  <ChevronDown
                    className={cn("size-4 text-muted-foreground shrink-0 transition-transform duration-200", open && "rotate-180")}
                    aria-hidden="true"
                  />
                </button>
                {open && (
                  <div className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed">
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
