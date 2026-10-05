# AshantiHub promo clips

Remotion project for the screen-led social clips in `docs/marketing/` (business clips 1 and 3,
customer clip 3). Each clip renders vertical 1080×1920 (iOS, Android) and landscape 1920×1080
(web) as H.264 MP4.

```bash
npm install
npm run studio          # preview and scrub the clips
npm run render:all      # all six → out/<clip>-<format>.mp4 (~6 min)
npm run render -- cust-why-support-vertical
```

## Voiceover, music and tap sounds (ElevenLabs)

1. Copy `.env.local.example` to `.env.local` and paste your key after `ELEVENLABS_API_KEY=`.
   `.env.local` is gitignored.
2. `npm run voices`: lists your voices plus library voices with an African/Ghanaian accent, with
   preview links. Put the chosen id in `.env.local` as `ELEVENLABS_VOICE_ID`.
3. `npm run audio`: generates one voice line per voiceover beat, an instrumental highlife bed per
   clip and a tap sound. Files go to `public/audio/`, and `src/generated/audio-manifest.json` is
   rewritten. Generated files are cached; `-- --force` regenerates them (spends credits again).
4. `npm run render:all`.

Without generated audio the clips render silent, with the captions at their planned times. With
it, captions are re-timed to the actual speech using ElevenLabs' character timestamps.

## Where things live

- `src/clips/voiceover.json`: what each clip says, plus its caption chunks. The clip configs and
  the audio script both read this file.
- `src/clips/<clip>.ts`: scenes (screens, scroll, zoom, taps in screenshot pixels, on-screen text).
- `public/screens/`: real staging screenshots (phone 1170×2532). Akosua Ntoma is a fictional
  demo store, and every scene showing it carries a "Demo store" label.
- `captions/*.srt`: captions for the two 60–90s promos (see `docs/marketing/shoot-package.md`).
