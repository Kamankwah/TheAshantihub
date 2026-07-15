import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiPost } from "../../apiClient.js";

// ─── ContactEnquiryForm ──────────────────────────────────────────────────
// POST /api/core/contact/. Mirrors EventSubmissionPanel.jsx's form-handling
// convention exactly: plain controlled inputs, local submitting/submitted/
// error state, a plain try/await apiPost/catch in the submit handler — no
// useMutation hook (this codebase doesn't use React Query mutations).
type Category = "general" | "support" | "account" | "sales";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "general", label: "General" },
  { id: "support", label: "Support" },
  { id: "account", label: "Account" },
  { id: "sales", label: "Sales" },
];

const inputClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ContactEnquiryForm() {
  const [category, setCategory] = useState<Category>("general");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim() !== "" && email.trim() !== "" && subject.trim() !== "" && message.trim() !== "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiPost("/api/core/contact/", {
        category,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        subject: subject.trim(),
        message: message.trim(),
      });
      setSubmitted(true);
    } catch (err) {
      setError("Could not send your message. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setCategory("general");
    setName("");
    setEmail("");
    setPhone("");
    setSubject("");
    setMessage("");
    setSubmitted(false);
    setError(null);
  };

  return (
    <div className="shadcn-scope">
      <div className="bg-card border rounded-xl p-6 md:p-8">
        <h2 className="text-lg font-bold text-foreground mb-1">Send Us a Message</h2>
        <p className="text-sm text-muted-foreground mb-5">
          Tell us what's going on and AshantiHub Support will get back to you.
        </p>

        {submitted ? (
          <div className="text-center py-8">
            <div className="text-3xl mb-3">✅</div>
            <h3 className="text-base font-semibold text-foreground mb-1">Message sent!</h3>
            <p className="text-sm text-muted-foreground mb-5">
              Thanks for reaching out — our support team will respond soon.
            </p>
            <Button onClick={resetForm} variant="outline">
              Send another message
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className={cn(
                    "rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors",
                    category === c.id
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-transparent text-muted-foreground hover:bg-accent",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-muted-foreground">Name *</span>
                <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-muted-foreground">Email *</span>
                <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted-foreground">Phone (optional)</span>
              <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0244 000 000" />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted-foreground">Subject *</span>
              <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What's this about?" />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted-foreground">Message *</span>
              <textarea
                className={cn(inputClass, "resize-vertical")}
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Tell us more…"
              />
            </label>

            {error && <div className="text-sm text-destructive">{error}</div>}

            <Button type="submit" disabled={!valid || submitting} className="self-start">
              {submitting ? "Sending…" : "Send Message"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
