import { Button } from "@/components/ui/button";

export type AboutCtaBandProps = {
  /** `AshantiHub`'s `user` state — gates the "Create Free Account" button
   *  (hidden once signed in), same convention as the inline row it replaces. */
  user: unknown;
  /** `()=>setAuthModal("signup")` */
  onCreateAccount: () => void;
  /** `()=>setPage("register")` */
  onRegister: () => void;
};

// ─── AboutCtaBand ────────────────────────────────────────────────────────
// docs/UI_MODERNIZATION_ROADMAP.md Phase H. Design 4 of 5 — the most
// stripped-down of the five: a solid brand-gold background (no gradient, no
// image, no cards), a short centered heading, and two inline buttons.
// Replaces the plain inline button row that used to close out App.jsx's
// About page block.
export function AboutCtaBand({ user, onCreateAccount, onRegister }: AboutCtaBandProps) {
  return (
    <div className="shadcn-scope">
      <div className="w-full bg-primary">
        <div className="max-w-2xl mx-auto px-4 py-12 lg:px-6 flex flex-col items-center text-center gap-5">
          <h3 className="text-xl md:text-2xl font-extrabold text-primary-foreground tracking-tight">
            Join the AshantiHub community
          </h3>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {!user && (
              <Button onClick={onCreateAccount} size="lg" variant="secondary">
                Create Free Account
              </Button>
            )}
            <Button
              onClick={onRegister}
              size="lg"
              variant="outline"
              className="bg-transparent border-primary-foreground/40 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              Register Business
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
