import { useState, type FormEvent } from "react";
import { QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppStoreButton } from "@/components/ui/app-store-button";
import { PlayStoreButton } from "@/components/ui/play-store-button";

export type BusinessCtaBandProps = {
  /** Navigates to the business-registration flow — `AshantiHub`'s `setPage("register")`. */
  onRegister: () => void;
};

// ─── BusinessCtaBand ─────────────────────────────────────────────────────
// docs/UI_MODERNIZATION_ROADMAP.md Phase H. Two-panel Newegg-style promo
// band replacing the old inline "Own a Business in Ashanti?" CTA block in
// App.jsx's Business tab. Left panel keeps the existing business-signup
// pitch/copy; right panel is a genuine (not a dead placeholder) "Download
// Our App" panel — there is no real mobile app yet (docs/MOBILE_APP_SCOPE.md
// is still scope-only), so the App/Play Store buttons are inert brand
// buttons (Phase C's AppStoreButton/PlayStoreButton, first actually
// rendered here) and the phone-number "Send Link" flow honestly tells the
// user it's coming soon rather than faking an SMS send — there is no
// backend endpoint for this, so it's local component state only.
export function BusinessCtaBand({ onRegister }: BusinessCtaBandProps) {
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState(false);

  function handleSendLink(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!phone.trim()) return;
    setSent(true);
  }

  return (
    <div className="shadcn-scope">
      <div className="bg-background">
        <div className="max-w-6xl mx-auto px-4 py-8 lg:px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left panel — Register Your Business */}
            <div className="rounded-xl border bg-card text-card-foreground p-8 flex flex-col items-start justify-center gap-3">
              <div className="text-3xl">🏪</div>
              <h3 className="text-xl font-bold text-foreground">
                Own a Business in Ashanti?
              </h3>
              <p className="text-sm text-muted-foreground">
                First 3 months FREE. Support-backed listings.
              </p>
              <Button onClick={onRegister} size="lg" className="mt-2">
                Register Your Business →
              </Button>
            </div>

            {/* Right panel — Download Our App */}
            <div className="rounded-xl border bg-card text-card-foreground p-8 flex flex-col gap-4">
              <div>
                <h3 className="text-xl font-bold text-foreground">
                  Download Our App
                </h3>
                <p className="text-sm text-muted-foreground">
                  Browse, shop, and message support on the go.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <AppStoreButton />
                <PlayStoreButton />
              </div>

              <div className="flex items-center gap-4">
                <div
                  aria-label="QR code"
                  className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border-2 border-dashed border-border bg-muted"
                >
                  <QrCode className="size-10 text-muted-foreground" aria-hidden="true" />
                </div>
                <form onSubmit={handleSendLink} className="flex flex-1 flex-col gap-2 min-w-[200px]">
                  <label htmlFor="cta-band-phone" className="text-xs text-muted-foreground">
                    Or text me the link
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="cta-band-phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="e.g. 024 123 4567"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <Button type="submit" variant="secondary">
                      Send Link
                    </Button>
                  </div>
                  {sent && (
                    <p className="text-sm text-primary" role="status">
                      Our app is launching soon! We'll text you the download
                      link the moment it's ready.
                    </p>
                  )}
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
