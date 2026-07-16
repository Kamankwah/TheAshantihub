import type { ComponentType, CSSProperties } from "react";
import { Mail } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useSiteSettings } from "@/hooks/useSiteSettings.js";
import { cn } from "@/lib/utils";

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
// contact "chips" — WhatsApp (via the passed-in WABtn) and, when set, the
// live `contact_email` from useSiteSettings() (same hook Footer2 already
// reads, GET /api/core/site-settings/ — no hardcoded email here). Replaces
// the plain inline CTA row that used to close out App.jsx's Contact page
// block; the signed-out "Create Free Account" button is kept alongside it.
export function ContactCtaBand({ user, onCreateAccount, whatsappPhone, whatsappName, WhatsAppButton }: ContactCtaBandProps) {
  const { data: settings } = useSiteSettings();
  const contactEmail = settings?.contact_email ?? "";

  return (
    <div className="shadcn-scope">
      <div className="bg-muted/50 border-t border-b">
        <div className="max-w-3xl mx-auto px-4 py-10 lg:px-6 text-center">
          <h3 className="text-base font-bold text-foreground mb-1">
            Prefer to talk to a human?
          </h3>
          <p className="text-sm text-muted-foreground mb-6">
            Reach our support team directly — we usually reply within minutes.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {/* WhatsApp support is an account-holder channel — guests use the
                in-app chat (open to everyone) instead. */}
            {user && (
              <span className="inline-flex rounded-full border bg-card p-1 shadow-sm">
                <WhatsAppButton phone={whatsappPhone} name={whatsappName} />
              </span>
            )}
            {contactEmail && (
              <a
                href={`mailto:${contactEmail}`}
                className={cn(buttonVariants({ variant: "outline", size: "lg" }), "rounded-full gap-2")}
              >
                <Mail className="size-4" aria-hidden="true" />
                {contactEmail}
              </a>
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
