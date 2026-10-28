import type { ComponentType, CSSProperties } from "react";
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
// The Contact tab's main shell — hero heading, and the
// ContactEnquiryForm. Message form only: no contact details (phone, email,
// address) are shown on this page. Does NOT render ContactCtaBand or Footer2 —
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
            account? Send us a message and AshantiHub Support will reply.
          </p>
        </div>

        <ContactEnquiryForm />
      </div>
    </div>
  );
}
