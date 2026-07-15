import { Button } from "@/components/ui/button";

export type EventsCtaBandProps = {
  /** `KUMASI_PHOTOS.akwasidae` — owned/passed down by App.jsx, not
   *  hardcoded here, per this codebase's existing "components/ui/ doesn't
   *  own App.jsx's photo constants" convention. */
  imageUrl: string;
  /** Opens EventSubmissionPanel — the exact same `setShowEventSubmit(true)`
   *  handler already wired to the Events tab's own "📅 Submit an Event"
   *  toggle button, reused here rather than inventing a second flag. */
  onSubmitEvent: () => void;
};

// ─── EventsCtaBand ───────────────────────────────────────────────────────
// docs/UI_MODERNIZATION_ROADMAP.md Phase H. Design 3 of 5 — an image-backed
// asymmetric split: a real Kumasi festival photo fills one half, a plain
// card-colored panel with the pitch + CTA fills the other. Sits at the end
// of the Events tab's grid section (after "Load more", before the
// page==="events" block's closing fragment), so it shows regardless of
// which category/zone filter is active.
export function EventsCtaBand({ imageUrl, onSubmitEvent }: EventsCtaBandProps) {
  return (
    <div className="shadcn-scope">
      <div className="max-w-6xl mx-auto my-8 px-4 lg:px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 overflow-hidden rounded-xl border">
          <div
            role="img"
            aria-label="Akwasidae festival, Kumasi"
            className="h-56 md:h-auto bg-cover bg-center bg-muted"
            style={{ backgroundImage: `url(${imageUrl})` }}
          />
          <div className="bg-card text-card-foreground p-8 flex flex-col justify-center items-start gap-3">
            <div className="text-3xl">🥁</div>
            <h3 className="text-xl font-bold text-foreground">
              Hosting an event?
            </h3>
            <p className="text-sm text-muted-foreground">
              Get seen by thousands of Kumasi visitors and locals — list your
              festival, concert, durbar, or gathering on AshantiHub.
            </p>
            <Button onClick={onSubmitEvent} size="lg" className="mt-2">
              Submit an Event →
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
