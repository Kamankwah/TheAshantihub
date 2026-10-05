// Generates the clips' audio with ElevenLabs: one voice line per voiceover beat
// (with character timestamps, so captions re-time to the actual speech), one
// instrumental music bed per clip, and a short tap sound for on-screen taps.
// Writes public/audio/** and src/generated/audio-manifest.json.
//
// Usage: npm run audio                 → generate anything missing (cached files are reused)
//        npm run audio -- --force      → regenerate everything (spends credits again)
//        npm run audio -- --no-music   → voice + tap only
// Needs ELEVENLABS_API_KEY in .env.local (see .env.local.example).
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env.local") });

const FORCE = process.argv.includes("--force");
const MUSIC = !process.argv.includes("--no-music");
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "feUarJlAD2AMiWax336v";
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const MUSIC_MODEL = process.env.ELEVENLABS_MUSIC_MODEL || "music_v2";
const MUSIC_PROMPT =
  "Warm, modern Ghanaian highlife groove: clean palm-wine guitar, soft bass, light shaker and congas. " +
  "Uplifting but calm, steady and unobtrusive so it sits under a voiceover. Instrumental only, no vocals.";

if (!process.env.ELEVENLABS_API_KEY) {
  console.error("ELEVENLABS_API_KEY is not set. Copy .env.local.example to .env.local and add your key.");
  process.exit(1);
}
if (!process.env.ELEVENLABS_VOICE_ID) {
  console.warn(`No ELEVENLABS_VOICE_ID set — using ${VOICE_ID}. Run \`npm run voices\` to pick a warm Ghanaian voice.`);
}

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
const audioDir = path.join(root, "public", "audio");
const manifestPath = path.join(root, "src", "generated", "audio-manifest.json");
// Spoken lines + caption chunks per clip: the same file the clip configs read.
const clips = Object.entries(JSON.parse(fs.readFileSync(path.join(root, "src", "clips", "voiceover.json"), "utf8"))).map(
  ([id, vo]) => ({ id, ...vo }),
);

async function streamToBuffer(stream) {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Maps each caption chunk onto the spoken line by its share of the text, then
// reads the speech time at that character from ElevenLabs' alignment.
function retimeCaptions(beat, alignment, beatStart, holdUntil) {
  const starts = alignment.characterStartTimesSeconds;
  const ends = alignment.characterEndTimesSeconds;
  const spokenLen = alignment.characters.length;
  const captionTotal = beat.captions.reduce((n, c) => n + normalize(c.text).length + 1, 0);
  const speechEnd = ends[ends.length - 1];
  let offset = 0;
  const timed = beat.captions.map((c) => {
    const at = Math.min(spokenLen - 1, Math.round((offset / captionTotal) * spokenLen));
    offset += normalize(c.text).length + 1;
    return { text: c.text, start: +(beatStart + Math.max(0, starts[at] - 0.08)).toFixed(2) };
  });
  return timed.map((c, i) => ({
    ...c,
    end: +(i + 1 < timed.length ? timed[i + 1].start : Math.min(holdUntil, beatStart + speechEnd + 0.6)).toFixed(2),
  }));
}

async function voiceLine(clipId, i, beat) {
  const dir = path.join(audioDir, clipId);
  fs.mkdirSync(dir, { recursive: true });
  const file = `audio/${clipId}/voice-${i + 1}.mp3`;
  const alignFile = path.join(dir, `voice-${i + 1}.alignment.json`);
  const key = JSON.stringify({ say: beat.say, VOICE_ID, MODEL_ID });
  if (!FORCE && fs.existsSync(alignFile)) {
    const cached = JSON.parse(fs.readFileSync(alignFile, "utf8"));
    if (cached.key === key) return { file, alignment: cached.alignment };
  }
  const res = await client.textToSpeech.convertWithTimestamps(VOICE_ID, {
    text: beat.say,
    modelId: MODEL_ID,
    outputFormat: "mp3_44100_128",
    voiceSettings: { stability: 0.5, similarityBoost: 0.8, style: 0.25, useSpeakerBoost: true },
  });
  fs.writeFileSync(path.join(root, "public", file), Buffer.from(res.audioBase64, "base64"));
  fs.writeFileSync(alignFile, JSON.stringify({ key, alignment: res.alignment }));
  console.log(`  voice ${clipId} #${i + 1}: ${res.alignment.characterEndTimesSeconds.at(-1).toFixed(1)}s`);
  return { file, alignment: res.alignment };
}

async function musicBed(clipId, seconds) {
  const file = `audio/${clipId}/music.mp3`;
  const abs = path.join(root, "public", file);
  if (!FORCE && fs.existsSync(abs)) return file;
  const stream = await client.music.compose({
    prompt: MUSIC_PROMPT,
    musicLengthMs: Math.round(seconds * 1000),
    modelId: MUSIC_MODEL,
    forceInstrumental: true,
  });
  fs.writeFileSync(abs, await streamToBuffer(stream));
  console.log(`  music ${clipId}: ${seconds}s`);
  return file;
}

async function tapSound() {
  const file = "audio/sfx-tap.mp3";
  const abs = path.join(root, "public", file);
  if (!FORCE && fs.existsSync(abs)) return file;
  const stream = await client.textToSoundEffects.convert({
    text: "A single soft, short smartphone screen tap, clean and dry, no reverb",
    durationSeconds: 0.5,
    promptInfluence: 0.6,
  });
  fs.writeFileSync(abs, await streamToBuffer(stream));
  console.log("  sfx tap");
  return file;
}

const manifest = { voiceId: VOICE_ID, modelId: MODEL_ID, clips: {}, sfx: {} };
fs.mkdirSync(audioDir, { recursive: true });
manifest.sfx.tap = await tapSound();

for (const clip of clips) {
  console.log(clip.id);
  const voice = [];
  const captions = [];
  for (const [i, beat] of clip.beats.entries()) {
    const { file, alignment } = await voiceLine(clip.id, i, beat);
    const duration = alignment.characterEndTimesSeconds.at(-1);
    const next = clip.beats[i + 1]?.start ?? clip.duration;
    if (beat.start + duration > next) {
      console.warn(`  ! ${clip.id} beat ${i + 1} runs ${(beat.start + duration - next).toFixed(1)}s into the next beat`);
    }
    voice.push({ file, start: beat.start, duration: +duration.toFixed(2) });
    captions.push(...retimeCaptions(beat, alignment, beat.start, next - 0.1));
  }
  manifest.clips[clip.id] = { voice, captions, music: MUSIC ? await musicBed(clip.id, clip.duration) : null };
}

fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${path.relative(root, manifestPath)}. Render with: npm run render:all`);
