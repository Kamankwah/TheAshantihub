import { MapPin, Phone, Mail, Clock } from "lucide-react";
import { useSiteSettings } from "@/hooks/useSiteSettings.js";

// ─── ContactInfoPanel ────────────────────────────────────────────────────
// Address/phone/email/hours rows sourced live from useSiteSettings(), each
// only rendered when non-empty. If all 4 are empty, shows a friendly
// "coming soon" message rather than an empty panel — same "no fabricated
// empty state" convention warranty_returns_policy's copy uses elsewhere.
export function ContactInfoPanel() {
  const { data: settings } = useSiteSettings();

  const rows = [
    { icon: MapPin, label: "Address", value: settings?.contact_address ?? "" },
    { icon: Phone, label: "Phone", value: settings?.contact_phone ?? "" },
    { icon: Mail, label: "Email", value: settings?.contact_email ?? "" },
    { icon: Clock, label: "Support Hours", value: settings?.support_hours ?? "" },
  ].filter((r) => r.value !== "");

  return (
    <div className="shadcn-scope">
      <div className="bg-card border rounded-xl p-6 h-full">
        <h2 className="text-lg font-bold text-foreground mb-5">Contact Details</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Contact details coming soon.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {rows.map((r) => (
              <div key={r.label} className="flex items-start gap-3">
                <r.icon className="size-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {r.label}
                  </div>
                  <div className="text-sm text-foreground">{r.value}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
