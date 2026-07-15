import { AppStoreButton } from "@/components/ui/app-store-button";
import { PlayStoreButton } from "@/components/ui/play-store-button";

// ─── HomeCtaBand ─────────────────────────────────────────────────────────
// docs/UI_MODERNIZATION_ROADMAP.md Phase H. Design 2 of 5 — a full-bleed,
// edge-to-edge "billboard" band: a single gold→deepGold gradient sweep with
// one centered, focused message ("Get the AshantiHub App"), deliberately
// simpler than BusinessCtaBand's two-card layout — no boxed cards, no QR
// code, no phone-number capture form (that richer flow already lives in
// BusinessCtaBand's right panel; duplicating it here would just be the same
// pitch twice on one page, which Phase H explicitly avoids). Renders
// unconditionally in App.jsx's page==="home" block, right after Hero and
// after the signed-in-only Referral CTA block (a different, unrelated
// pitch — referral rewards, not app download) — so it shows for signed-in
// and signed-out visitors alike.
export function HomeCtaBand() {
  return (
    <div className="shadcn-scope">
      <div className="w-full bg-gradient-to-r from-primary via-accent to-primary">
        <div className="max-w-3xl mx-auto px-4 py-14 lg:px-6 flex flex-col items-center text-center gap-3">
          <h2 className="text-2xl md:text-3xl font-extrabold text-primary-foreground">
            Get the AshantiHub App
          </h2>
          <p className="text-sm md:text-base text-primary-foreground/80 max-w-md">
            Browse, shop, and message support on the go — download AshantiHub today.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-3">
            <AppStoreButton variant="secondary" />
            <PlayStoreButton variant="secondary" />
          </div>
        </div>
      </div>
    </div>
  );
}
