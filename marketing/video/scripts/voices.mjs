// Lists ElevenLabs voices that suit AshantiHub: your own voices, plus library
// voices with an African/Ghanaian English accent, each with a preview link.
// Usage: npm run voices                      → list candidates
//        npm run voices -- --search nigerian  → different library search term
// Put the chosen voice's id in .env.local as ELEVENLABS_VOICE_ID. A library
// voice may need adding to your account first (ElevenLabs Voice Library → Add).
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env.local") });
if (!process.env.ELEVENLABS_API_KEY) {
  console.error("ELEVENLABS_API_KEY is not set. Copy .env.local.example to .env.local and add your key.");
  process.exit(1);
}
const flag = process.argv.indexOf("--search");
const term = flag > -1 ? process.argv[flag + 1] : "ghanaian";

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

const mine = await client.voices.search({ pageSize: 50 });
console.log("Your voices:");
for (const v of mine.voices ?? []) console.log(`  ${v.voiceId}  ${v.name}${v.labels?.accent ? `  (${v.labels.accent})` : ""}`);

for (const query of [{ search: term }, { accent: "african", language: "en" }]) {
  const lib = await client.voices.getShared({ pageSize: 15, ...query });
  console.log(`\nLibrary voices for ${JSON.stringify(query)}:`);
  for (const v of lib.voices ?? []) {
    console.log(`  ${v.voiceId}  ${v.name}  [${v.gender ?? "?"}, ${v.accent ?? "?"}]  ${v.previewUrl ?? ""}`);
    if (v.description) console.log(`      ${v.description.slice(0, 110)}`);
  }
}
