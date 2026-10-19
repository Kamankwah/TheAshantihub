import type { ComponentType, CSSProperties } from "react";
import { Button } from "@/components/ui/button";

export type ContactCtaBandProps = {
  /** `AshantiHub`'s `user` state — gates the "Create Free Account" button,
   *  same as the inline row it replaces. */
  user: unknown;
  /** `()=>setAuthModal("signup")` */
  onCreateAccount: () => void;
  /** The `phone`/`name` App.jsx already passes to `WABtn` on the Contact
   *  page (`"233244000000"` / `"AshantiHub Support"`), threaded through
   *  rather than hardcoded here. */
  whatsappPhone: string;
  whatsappName: string;
  /** App.jsx's `WABtn` — this codebase's genuine platform-support WhatsApp
   *  link component (kept deliberately, see CLAUDE.md's "Businesses cannot
   *  be contacted directly" note; this is a legitimate kept use, not a
   *  business-contact link). Passed as a prop rather than imported directly,
   *  same "avoid an App.jsx ⇄ components/ui/ circular import" convention as
   *  ListingDetailPage's `CardComponent`. */
  WhatsAppButton: ComponentType<{ phone: string; name: string; style?: CSSProperties }>;
};

// ─── ContactCtaBand ──────────────────────────────────────────────────────
// docs/UI_MODERNIZATION_ROADMAP.md Phase H. Design 5 of 5 — deliberately
// NOT another app-download or business-registration pitch (the other four
// bands already cover that ground): a support-focused horizontal row of
// contact "chips" — WhatsApp (via the passed-in WABtn, AshantiHub's own
// support number). No email is shown (Plan M1: no contact details on the
// Contact page; messages go through the form). Replaces
// the plain inline CTA row that used to close out App.jsx's Contact page
// block; the signed-out "Create Free Account" button is kept alongside it.
export function ContactCtaBand({ user, onCreateAccount, whatsappPhone, whatsappName, WhatsAppButton }: ContactCtaBandProps) {
  return (
    <div className="shadcn-scope">
      <div className="bg-muted/50 border-t border-b">
        <div className="max-w-3xl mx-auto px-4 py-10 lg:px-6 text-center">
          <h3 className="text-base font-bold text-foreground mb-1">
            Prefer to talk to a human?
          </h3>
          <p className="text-sm text-muted-foreground mb-6">
            Signed-in members can reach AshantiHub Support on WhatsApp.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {/* WhatsApp support is an account-holder channel — guests use the
                in-app chat (open to everyone) instead. */}
            {user && (
              <span className="inline-flex rounded-full border bg-card p-1 shadow-sm">
                <WhatsAppButton phone={whatsappPhone} name={whatsappName} />
              </span>
            )}
            {!user && (
              <Button onClick={onCreateAccount} size="lg" className="rounded-full">
                Create Free Account
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
