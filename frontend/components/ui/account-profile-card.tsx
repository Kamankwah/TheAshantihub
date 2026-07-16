import { useEffect, useId, useState } from "react";
import { ImagePlus, ShieldCheck } from "lucide-react";
import { useImageUpload } from "@/hooks/useImageUpload.ts";
import { useMyCustomerProfile } from "@/hooks/useMyCustomerProfile.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar.tsx";

export type AccountProfileCardProps = {
  /** UserPanel's hand-picked `user` object — only fullName/avatar are read. */
  user: { fullName?: string; avatar?: string | null } | null;
  /** `useAuth()`'s returned object. */
  auth: {
    updateProfile: (fields: Record<string, unknown>) => Promise<unknown>;
    refreshUser: () => Promise<unknown>;
    requestSecondaryEmail: (email: string) => Promise<{ demo_code: string }>;
    confirmSecondaryEmail: (code: string) => Promise<unknown>;
    requestSecondaryPhone: (phone: string) => Promise<{ demo_code: string }>;
    confirmSecondaryPhone: (code: string) => Promise<unknown>;
  };
};

const GENDER_OPTIONS = [
  { value: "", label: "Prefer not to answer here" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

function computeAge(dob?: string | null): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

type SecondaryContactFieldProps = {
  label: string;
  placeholder: string;
  inputType?: string;
  value: string | null | undefined;
  verified: boolean;
  onRequest: (value: string) => Promise<{ demo_code: string }>;
  onConfirm: (code: string) => Promise<unknown>;
  onChanged: () => void;
};

// Shared 3-state widget for a verified secondary contact (recovery email or
// recovery phone) — no secondary value yet / a pending unverified value with
// a code-entry box / a verified value with a "Change" escape hatch. Backs
// both the email and phone recovery fields below rather than two near-
// identical copies of this state machine.
function SecondaryContactField({ label, placeholder, inputType = "text", value, verified, onRequest, onConfirm, onChanged }: SecondaryContactFieldProps) {
  const id = useId();
  const [mode, setMode] = useState<"idle" | "editing" | "code">(value ? "code" : "idle");
  const [draft, setDraft] = useState(value || "");
  const [code, setCode] = useState("");
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (verified) setMode("idle");
    else if (value) setMode("code");
  }, [value, verified]);

  const sendCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await onRequest(draft);
      setDemoCode(res.demo_code);
      setCode("");
      setMode("code");
      onChanged();
    } catch {
      setError("Could not send a verification code. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      await onConfirm(code);
      setDemoCode(null);
      onChanged();
    } catch {
      setError("Incorrect or expired code.");
    } finally {
      setBusy(false);
    }
  };

  if (verified && mode === "idle") {
    return (
      <div className="space-y-1.5">
        <Label>{label}</Label>
        <div className="flex items-center justify-between rounded-lg border border-input bg-background px-3 py-2 text-sm">
          <span className="flex items-center gap-1.5 text-foreground">
            <ShieldCheck size={14} className="text-emerald-500" /> {value}
          </span>
          <button
            type="button"
            onClick={() => { setDraft(""); setMode("editing"); }}
            className="text-xs font-medium text-primary hover:underline"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  if (mode === "code") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-code`}>{label} — enter the code sent to {value}</Label>
        {demoCode && (
          <p className="rounded-lg border border-dashed border-primary/50 bg-primary/10 px-3 py-2 text-xs text-foreground">
            📩 Demo mode — no real email/SMS is sent yet, so here's your code: <span className="font-mono font-bold">{demoCode}</span> (expires in 10 minutes)
          </p>
        )}
        <div className="flex gap-2">
          <Input id={`${id}-code`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" maxLength={6} />
          <Button type="button" size="sm" onClick={verify} disabled={busy || code.length !== 6}>Verify</Button>
        </div>
        <div className="flex gap-3 text-xs">
          <button type="button" onClick={sendCode} disabled={busy} className="font-medium text-primary hover:underline">Resend code</button>
          <button type="button" onClick={() => { setDraft(""); setDemoCode(null); setMode("editing"); }} className="font-medium text-muted-foreground hover:underline">Use a different {label.toLowerCase()}</button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${id}-value`}>{label}</Label>
      <div className="flex gap-2">
        <Input id={`${id}-value`} type={inputType} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} />
        <Button type="button" size="sm" onClick={sendCode} disabled={busy || !draft}>Send code</Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ─── AccountProfileCard ─────────────────────────────────────────────────────
// The Account panel's Profile tab, on a shadcn/Tailwind card (gold/blue
// gradient banner + centered avatar-with-upload-button). Mounted inside
// UserPanel, which already carries the `.command-center` CSS scope (see
// frontend/index.css) — bg-background/text-foreground/bg-primary/etc. here
// resolve to that scope's dark gold "mission control" tokens automatically.
//
// Sources the full field set from useMyCustomerProfile() (GET
// /api/accounts/customers/me/profile/) rather than the lightweight `user`
// prop, which only carries fullName/avatar. Primary email/phone are
// rendered read-only (they're the account's login identifiers, with no
// change-verification flow); a secondary/recovery email and phone can each
// be added and verified independently via SecondaryContactField above, since
// PATCHing them directly wouldn't be safe without proving the new address/
// number is actually reachable by this person. date_of_birth is used
// (not a raw "age" field) since age drifts out of date — computeAge()
// derives a display-only age from it.
export function AccountProfileCard({ user, auth }: AccountProfileCardProps) {
  const id = useId();
  const { data: profile, refetch } = useMyCustomerProfile();

  const [fullName, setFullName] = useState(user?.fullName || "");
  const [address, setAddress] = useState("");
  const [gender, setGender] = useState("");
  const [dob, setDob] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { previewUrl, file, fileInputRef, handleThumbnailClick, handleFileChange, reset } = useImageUpload();

  useEffect(() => {
    setFullName(user?.fullName || "");
  }, [user?.fullName]);

  useEffect(() => {
    if (!profile) return;
    setAddress(profile.address || "");
    setGender(profile.gender || "");
    setDob(profile.date_of_birth || "");
  }, [profile]);

  const avatarSrc = previewUrl || user?.avatar || undefined;
  const initial = (fullName || "U").trim()[0]?.toUpperCase() || "U";
  const age = computeAge(dob);

  const showToast = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleCancel = () => {
    setFullName(user?.fullName || "");
    setAddress(profile?.address || "");
    setGender(profile?.gender || "");
    setDob(profile?.date_of_birth || "");
    reset(user?.avatar || null);
    setError(null);
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      await auth.updateProfile({ full_name: fullName, avatar: file, address, gender, date_of_birth: dob });
      await auth.refreshUser();
      await refetch();
      showToast();
    } catch {
      setError("Could not save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="shadcn-scope relative max-w-xl">
      {saved && (
        <div className="absolute -top-3 right-0 z-10 -translate-y-full rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-emerald-950 shadow-lg">
          ✓ Saved!
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
        <div
          className="h-28 sm:h-32"
          style={{ background: "radial-gradient(circle, rgba(212,160,23,0.45) 0%, rgba(96,165,250,0.28) 100%)" }}
        />

        <div className="-mt-12 flex justify-center">
          <div className="relative">
            <Avatar className="h-24 w-24 border-4 border-card shadow-lg">
              <AvatarImage src={avatarSrc} alt="" />
              <AvatarFallback className="text-xl">{initial}</AvatarFallback>
            </Avatar>
            <button
              type="button"
              onClick={handleThumbnailClick}
              className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
              aria-label="Change profile picture"
            >
              <ImagePlus size={16} />
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              accept="image/*"
            />
          </div>
        </div>

        <div className="space-y-5 px-6 pb-2 pt-5">
          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Personal info */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-name`}>Full name</Label>
              <Input id={`${id}-name`} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="E.g. Ama Boateng" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${id}-address`}>Address</Label>
              <Input id={`${id}-address`} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="E.g. 12 Prempeh II St, Kumasi" />
            </div>

            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`${id}-gender`}>Gender</Label>
                <select
                  id={`${id}-gender`}
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm shadow-black/5 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20"
                >
                  {GENDER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`${id}-dob`}>Date of birth {age != null && <span className="text-muted-foreground">({age} yrs)</span>}</Label>
                <Input id={`${id}-dob`} type="date" value={dob} onChange={(e) => setDob(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
              </div>
            </div>
          </div>

          <div className="border-t border-border pt-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact &amp; recovery</p>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={profile?.email || "Not set"} disabled />
                <p className="text-xs text-muted-foreground">Your sign-in email — can&apos;t be changed here yet.</p>
              </div>

              <SecondaryContactField
                label="Recovery email"
                placeholder="you@example.com"
                inputType="email"
                value={profile?.secondary_email}
                verified={!!profile?.secondary_email_verified}
                onRequest={auth.requestSecondaryEmail}
                onConfirm={auth.confirmSecondaryEmail}
                onChanged={refetch}
              />

              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={profile?.phone || "Not set"} disabled />
                <p className="text-xs text-muted-foreground">Your sign-in phone number — can&apos;t be changed here yet.</p>
              </div>

              <SecondaryContactField
                label="Recovery phone"
                placeholder="024xxxxxxx"
                inputType="tel"
                value={profile?.secondary_phone}
                verified={!!profile?.secondary_phone_verified}
                onRequest={auth.requestSecondaryPhone}
                onConfirm={auth.confirmSecondaryPhone}
                onChanged={refetch}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              A verified recovery email or phone lets you regain access if you ever forget your password.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border bg-card px-6 py-4">
          <Button type="button" variant="outline" onClick={handleCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
