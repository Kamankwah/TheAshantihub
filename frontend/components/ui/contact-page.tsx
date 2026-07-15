import type { ComponentType, CSSProperties } from "react";
import { ContactInfoPanel } from "@/components/ui/contact-info-panel.tsx";
import { ContactSocialRing } from "@/components/ui/contact-social-ring.tsx";
import { ContactEnquiryForm } from "@/components/ui/contact-enquiry-form.tsx";

export type ContactPageProps = {
  /** `AshantiHub`'s `user` state — accepted for parity with the other page
   *  shells even though this component doesn't itself gate anything on it
   *  (ContactCtaBand, rendered separately right after this, already owns
   *  the signed-out "Create Free Account" CTA). */
  user: unknown;
  /** `()=>setAuthModal("signup")` — accepted for the same parity reason as
   *  `user` above; unused inside this shell today. */
  onCreateAccount: () => void;
  /** App.jsx's `WABtn` — accepted for the same "avoid an App.jsx <->
   *  components/ui circular import" convention other pages use, though
   *  this shell doesn't currently render it itself (ContactCtaBand does). */
  WhatsAppButton?: ComponentType<{ phone: string; name: string; style?: CSSProperties }>;
};

// ─── ContactPage ─────────────────────────────────────────────────────────
// The Contact tab's main shell — hero heading, a two-column
// ContactInfoPanel/ContactSocialRing row, and the full-width
// ContactEnquiryForm below. Does NOT render ContactCtaBand or Footer2 —
// those stay in App.jsx, rendered separately after this component.
export function ContactPage({ user: _user, onCreateAccount: _onCreateAccount, WhatsAppButton: _WhatsAppButton }: ContactPageProps) {
  return (
    <div className="shadcn-scope">
      <div className="max-w-5xl mx-auto px-4 py-14 lg:px-6">
        <div className="text-center mb-10">
          <h1 className="text-3xl md:text-4xl font-extrabold text-foreground tracking-tight mb-2">
            Get In Touch
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Questions about a listing, a partnership, or your business
            account? We're based in Kumasi and we reply fast.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
          <ContactInfoPanel />
          <ContactSocialRing />
        </div>

        <ContactEnquiryForm />
      </div>
    </div>
  );
}
